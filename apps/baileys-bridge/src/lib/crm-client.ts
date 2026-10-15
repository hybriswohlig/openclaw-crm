/**
 * Typed HTTP client for the CRM webhooks the bridge calls.
 *
 * All requests authenticate with the bridge's API key (`oc_sk_*`) as a
 * Bearer token. The CRM resolves the workspace from the key, so the
 * bridge never sends a workspace id.
 */
import type { Logger } from "./logger.js";

export interface InhouseAccount {
  id: string;
  name: string;
  address: string;
  pairingStatus: string | null;
  ownJid: string | null;
  operatingCompanyRecordId: string | null;
}

export interface InboundAttachment {
  fileName: string;
  mimeType: string;
  fileSize: number;
  fileContentBase64: string;
  externalMediaId?: string | null;
}

export interface InboundPayload {
  accountId: string;
  // The peer's REAL phone number (digits only) whenever it is known. For
  // LID-routed chats this is the resolved PN from remoteJidAlt / the LID
  // mapping store; only when no mapping exists does it fall back to the
  // LID digits (the CRM detects that by comparing with peerJid).
  peerWaId: string;
  // Full peer JID with domain preserved (`@lid` or `@s.whatsapp.net`).
  // The CRM stores this so outbound sends can target the same addressing
  // mode the contact answered from. Optional for backward-compat with
  // older CRM deployments that don't know the field.
  peerJid?: string;
  // The peer's LID JID whenever known, INDEPENDENT of the addressing mode of
  // this message: equals peerJid for LID-routed stanzas, and carries
  // remoteJidAlt for PN-routed stanzas of a LID-capable peer. Lets the CRM
  // match LID-keyed threads/identities when the addressing mode flips.
  peerLid?: string | null;
  peerName?: string | null;
  body: string;
  previewLabel?: string | null;
  externalMessageId: string;
  sentAt?: string;
  rawHeaders?: Record<string, unknown> | null;
  attachments?: InboundAttachment[];
  /**
   * True for rows recovered from a re-pair history sync. The CRM stores
   * them on the timeline and does not arm the sales agent or push.
   * Omitted on the live path. Not posted while the cursor route is absent.
   */
  historySync?: boolean;
}

/** Outbound = messages the operator typed on the linked phone, or a bridge send being recorded. */
export interface OutboundPayload {
  accountId: string;
  peerWaId: string;
  // See InboundPayload.peerJid — same field, same purpose. Here the JID
  // identifies the recipient the operator was texting from their phone.
  peerJid?: string;
  // See InboundPayload.peerLid.
  peerLid?: string | null;
  body: string;
  previewLabel?: string | null;
  externalMessageId: string;
  sentAt?: string;
  /**
   * `bridge-send` = this process just sent the message and is recording it.
   * Omitted for phone-typed echoes (`messages.upsert` type notify).
   */
  origin?: "bridge-send";
  rawHeaders?: Record<string, unknown> | null;
  attachments?: InboundAttachment[];
  /** See InboundPayload.historySync. */
  historySync?: boolean;
}

export interface PairingPayload {
  accountId: string;
  status:
    | "idle"
    | "awaiting_qr"
    | "awaiting_code"
    | "connecting"
    | "connected"
    | "logged_out"
    | "error";
  qrPayload?: string | null;
  pairingCode?: string | null;
  ownJid?: string | null;
  disconnectReason?: string | null;
}

export interface StatusPayload {
  accountId: string;
  externalMessageId: string;
  status: "sent" | "delivered" | "read" | "failed";
  timestamp?: string;
  errorReason?: string | null;
}

export class CrmClient {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
    private readonly log: Logger,
  ) {}

  private async fetch(
    path: string,
    init: RequestInit & { method: string },
    opts?: { quietStatuses?: number[] },
  ): Promise<Response> {
    const url = `${this.baseUrl}${path}`;
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${this.apiKey}`);
    if (init.body && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }
    const res = await fetch(url, { ...init, headers });
    if (!res.ok && !opts?.quietStatuses?.includes(res.status)) {
      const text = await res.text().catch(() => "");
      this.log.warn(
        { status: res.status, path, body: text.slice(0, 500) },
        "[crm-client] non-OK response",
      );
    }
    return res;
  }

  /**
   * Newest message already stored for this account, plus a flag that the
   * deployed CRM knows how to accept a history catch-up safely. A non-OK
   * response means the CRM is older than this bridge: callers must skip
   * posting history rather than send it through the live ingest path.
   *
   * The route 404s on the web app today. That absence is expected and is
   * not logged; callers treat it as "not supported".
   */
  async getHistoryCursor(
    accountId: string,
  ): Promise<{ supported: boolean; historySince: string | null }> {
    let res: Response;
    try {
      res = await this.fetch(
        `/api/v1/inbox/whatsapp/baileys-history-cursor/${accountId}`,
        { method: "GET" },
        { quietStatuses: [404] },
      );
    } catch (err) {
      this.log.warn(
        { err, accountId },
        "[crm-client] history cursor lookup failed",
      );
      return { supported: false, historySince: null };
    }
    if (!res.ok) return { supported: false, historySince: null };
    const json = (await res.json()) as {
      historySyncSupported?: boolean;
      historySince?: string | null;
    };
    if (json.historySyncSupported !== true) {
      return { supported: false, historySince: null };
    }
    return {
      supported: true,
      historySince: typeof json.historySince === "string" ? json.historySince : null,
    };
  }

  async listInhouseAccounts(): Promise<InhouseAccount[]> {
    const res = await this.fetch(
      "/api/v1/inbox/whatsapp/baileys-accounts",
      { method: "GET" },
    );
    if (!res.ok) return [];
    const json = (await res.json()) as { accounts?: InhouseAccount[] };
    return json.accounts ?? [];
  }

  async getAuthState(accountId: string): Promise<unknown | null> {
    const res = await this.fetch(
      `/api/v1/inbox/whatsapp/baileys-creds/${accountId}`,
      { method: "GET" },
    );
    if (!res.ok) return null;
    const json = (await res.json()) as { state?: unknown };
    return json.state ?? null;
  }

  async putAuthState(
    accountId: string,
    state: unknown | null,
  ): Promise<void> {
    await this.fetch(
      `/api/v1/inbox/whatsapp/baileys-creds/${accountId}`,
      {
        method: "PUT",
        body: JSON.stringify({ state }),
      },
    );
  }

  async postInbound(p: InboundPayload): Promise<void> {
    await this.fetch("/api/v1/inbox/whatsapp/baileys-inbound", {
      method: "POST",
      body: JSON.stringify(p),
    });
  }

  /** @returns false when the CRM refused the row (the WhatsApp send already happened). */
  async postOutbound(p: OutboundPayload): Promise<boolean> {
    const res = await this.fetch("/api/v1/inbox/whatsapp/baileys-outbound", {
      method: "POST",
      body: JSON.stringify(p),
    });
    if (!res.ok) return false;
    // 2xx includes the internal-number no-op (`{ intern: true }`), which is
    // an intentional skip rather than a failed record.
    await res.json().catch(() => ({}));
    return true;
  }

  async postPairing(p: PairingPayload): Promise<void> {
    await this.fetch("/api/v1/inbox/whatsapp/baileys-pairing", {
      method: "POST",
      body: JSON.stringify(p),
    });
  }

  async postStatus(p: StatusPayload): Promise<void> {
    await this.fetch("/api/v1/inbox/whatsapp/baileys-status", {
      method: "POST",
      body: JSON.stringify(p),
    });
  }
}
