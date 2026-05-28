/**
 * Per-account Baileys socket manager.
 *
 * Owns one WhatsApp WebSocket per channel-account, plus the lifecycle
 * machinery that pushes pairing updates back to the CRM and
 * automatically reconnects on transient disconnects.
 *
 * Thread-safe-ish: each `start(accountId)` call coalesces with any
 * already-running entry, so the HTTP control plane can fire the same
 * call repeatedly without spawning duplicate sockets.
 */
import { makeWASocket } from "baileys";
import type { WASocket } from "baileys";
import type { Logger } from "../lib/logger.js";
import type { CrmClient } from "../lib/crm-client.js";
import {
  makeCrmAuthState,
  type CrmAuthStateHandle,
} from "../auth-state/crm-auth-state.js";
import { attachInboundHandler } from "../inbound/handler.js";
import { attachStatusHandler } from "../inbound/status-handler.js";
import { classifyDisconnect, pushPairingUpdate } from "./lifecycle.js";

interface Entry {
  accountId: string;
  sock: WASocket | null;
  authState: CrmAuthStateHandle | null;
  status:
    | "starting"
    | "awaiting_qr"
    | "connecting"
    | "connected"
    | "stopped"
    | "logged_out"
    | "error";
  retryCount: number;
  lastError: string | null;
  // True between an explicit stop() and the close handler firing — prevents
  // the auto-reconnect logic from racing with operator intent.
  stopRequested: boolean;
}

export interface SocketManagerOptions {
  crm: CrmClient;
  log: Logger;
}

export class SocketManager {
  private readonly entries = new Map<string, Entry>();
  private readonly crm: CrmClient;
  private readonly log: Logger;

  constructor(opts: SocketManagerOptions) {
    this.crm = opts.crm;
    this.log = opts.log;
  }

  has(accountId: string): boolean {
    return this.entries.has(accountId);
  }

  health(): Array<{
    id: string;
    status: Entry["status"];
    retryCount: number;
    lastError: string | null;
  }> {
    return [...this.entries.values()].map((e) => ({
      id: e.accountId,
      status: e.status,
      retryCount: e.retryCount,
      lastError: e.lastError,
    }));
  }

  /** Idempotent. Starts a new socket if none is running for this account. */
  async start(accountId: string): Promise<void> {
    const existing = this.entries.get(accountId);
    if (existing && existing.status !== "stopped" && existing.status !== "error" && existing.status !== "logged_out") {
      this.log.debug({ accountId }, "[manager] already running, no-op");
      return;
    }
    const entry: Entry = existing ?? {
      accountId,
      sock: null,
      authState: null,
      status: "starting",
      retryCount: 0,
      lastError: null,
      stopRequested: false,
    };
    entry.status = "starting";
    entry.lastError = null;
    entry.stopRequested = false;
    this.entries.set(accountId, entry);
    await this.spawnSocket(entry);
  }

  /** Idempotent. Ends the socket but does NOT clear auth state. */
  async stop(accountId: string): Promise<void> {
    const entry = this.entries.get(accountId);
    if (!entry) return;
    entry.stopRequested = true;
    try {
      await entry.authState?.flush();
    } catch (err) {
      this.log.warn({ err, accountId }, "[manager] flush on stop failed");
    }
    try {
      entry.sock?.end(undefined);
    } catch (err) {
      this.log.warn({ err, accountId }, "[manager] sock.end threw");
    }
    entry.sock = null;
    entry.status = "stopped";
  }

  async stopAll(): Promise<void> {
    await Promise.all([...this.entries.keys()].map((id) => this.stop(id)));
  }

  /** Used by the HTTP send route. Returns the assigned key.id. */
  async sendText(
    accountId: string,
    peerWaId: string,
    body: string,
  ): Promise<{ keyId: string }> {
    const entry = this.entries.get(accountId);
    if (!entry || !entry.sock || entry.status !== "connected") {
      throw new Error(
        `account ${accountId} is not connected (status=${entry?.status ?? "missing"})`,
      );
    }
    const jid = peerJidFor(peerWaId);
    const result = await entry.sock.sendMessage(jid, { text: body });
    if (!result?.key?.id) {
      throw new Error("sendMessage returned no key.id");
    }
    return { keyId: result.key.id };
  }

  async sendMedia(
    accountId: string,
    peerWaId: string,
    media: {
      kind: "image" | "video" | "audio" | "document";
      mediaBase64: string;
      mimeType: string;
      fileName?: string;
      caption?: string;
    },
  ): Promise<{ keyId: string }> {
    const entry = this.entries.get(accountId);
    if (!entry || !entry.sock || entry.status !== "connected") {
      throw new Error(
        `account ${accountId} is not connected (status=${entry?.status ?? "missing"})`,
      );
    }
    const jid = peerJidFor(peerWaId);
    const buf = Buffer.from(media.mediaBase64, "base64");

    let content: Parameters<WASocket["sendMessage"]>[1];
    switch (media.kind) {
      case "image":
        content = {
          image: buf,
          mimetype: media.mimeType,
          caption: media.caption,
        };
        break;
      case "video":
        content = {
          video: buf,
          mimetype: media.mimeType,
          caption: media.caption,
        };
        break;
      case "audio":
        content = {
          audio: buf,
          mimetype: media.mimeType,
          ptt: media.mimeType.startsWith("audio/ogg"),
        };
        break;
      case "document":
        content = {
          document: buf,
          mimetype: media.mimeType,
          fileName: media.fileName ?? "document",
          caption: media.caption,
        };
        break;
    }
    const result = await entry.sock.sendMessage(jid, content);
    if (!result?.key?.id) {
      throw new Error("sendMessage returned no key.id");
    }
    return { keyId: result.key.id };
  }

  // ── private ───────────────────────────────────────────────────────────

  private async spawnSocket(entry: Entry): Promise<void> {
    const { accountId } = entry;
    const accountLog = this.log.child({ accountId });

    try {
      const authState = await makeCrmAuthState({
        accountId,
        crm: this.crm,
        log: accountLog,
      });
      entry.authState = authState;

      const sock = makeWASocket({
        auth: authState.state,
        logger: accountLog as never,
        printQRInTerminal: false,
        markOnlineOnConnect: false,
      });
      entry.sock = sock;
      entry.status = "starting";

      sock.ev.on("creds.update", () => authState.markDirty());

      attachInboundHandler({ accountId, sock, crm: this.crm, log: accountLog });
      attachStatusHandler({ accountId, sock, crm: this.crm, log: accountLog });

      sock.ev.on("connection.update", async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
          entry.status = "awaiting_qr";
          await pushPairingUpdate(
            { accountId, crm: this.crm, log: accountLog },
            { status: "awaiting_qr", qrPayload: qr },
          );
        }

        if (connection === "connecting") {
          entry.status = "connecting";
          await pushPairingUpdate(
            { accountId, crm: this.crm, log: accountLog },
            { status: "connecting" },
          );
        }

        if (connection === "open") {
          entry.status = "connected";
          entry.retryCount = 0;
          entry.lastError = null;
          const ownJid = sock.user?.id ?? null;
          await pushPairingUpdate(
            { accountId, crm: this.crm, log: accountLog },
            { status: "connected", ownJid, qrPayload: null },
          );
        }

        if (connection === "close") {
          if (entry.stopRequested) {
            entry.status = "stopped";
            return;
          }
          const decision = classifyDisconnect(lastDisconnect, entry.retryCount);
          if (decision.action === "stop_logged_out") {
            entry.status = "logged_out";
            try {
              await authState.clear();
            } catch (err) {
              accountLog.warn(
                { err },
                "[manager] auth-state clear on logout failed",
              );
            }
            await pushPairingUpdate(
              { accountId, crm: this.crm, log: accountLog },
              { status: "logged_out", disconnectReason: decision.reason },
            );
            return;
          }
          if (decision.action === "stop_error") {
            entry.status = "error";
            entry.lastError = decision.reason;
            await pushPairingUpdate(
              { accountId, crm: this.crm, log: accountLog },
              { status: "error", disconnectReason: decision.reason },
            );
            return;
          }
          // Reconnect path.
          entry.retryCount += 1;
          accountLog.info(
            { delayMs: decision.delayMs, retryCount: entry.retryCount },
            "[manager] reconnecting after close",
          );
          setTimeout(() => {
            // Latest entry may have been replaced; re-fetch.
            const live = this.entries.get(accountId);
            if (!live || live.stopRequested) return;
            void this.spawnSocket(live);
          }, decision.delayMs);
        }
      });
    } catch (err) {
      entry.status = "error";
      entry.lastError = err instanceof Error ? err.message : String(err);
      accountLog.error({ err }, "[manager] spawn failed");
      await pushPairingUpdate(
        { accountId, crm: this.crm, log: accountLog },
        {
          status: "error",
          disconnectReason: entry.lastError ?? "spawn_failed",
        },
      );
    }
  }
}

// Accepts either a digits-only WA id (legacy CRM call path, defaults to
// `@s.whatsapp.net`) or a full JID with explicit domain (`@lid`,
// `@s.whatsapp.net`, ...). The explicit-JID form is required for contacts
// whose Meta identity has migrated to LID-routing — defaulting them to
// `@s.whatsapp.net` makes WhatsApp's USync return empty, the message stays
// pending, and the customer never receives it.
function peerJidFor(peerWaId: string): string {
  if (peerWaId.includes("@")) {
    const at = peerWaId.indexOf("@");
    const local = peerWaId
      .slice(0, at)
      .replace(/^\+/, "")
      .replace(/:.*$/, "")
      .replace(/\s+/g, "");
    return `${local}${peerWaId.slice(at)}`;
  }
  const digits = peerWaId.replace(/\D+/g, "");
  return `${digits}@s.whatsapp.net`;
}
