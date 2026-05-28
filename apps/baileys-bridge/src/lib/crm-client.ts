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
  peerWaId: string;
  // Full peer JID with domain preserved (`@lid` or `@s.whatsapp.net`).
  // The CRM stores this so outbound sends can target the same addressing
  // mode the contact answered from. Optional for backward-compat with
  // older CRM deployments that don't know the field.
  peerJid?: string;
  peerName?: string | null;
  body: string;
  previewLabel?: string | null;
  externalMessageId: string;
  sentAt?: string;
  rawHeaders?: Record<string, unknown> | null;
  attachments?: InboundAttachment[];
}

/** Outbound = messages the operator typed on the linked phone, not via the CRM. */
export interface OutboundPayload {
  accountId: string;
  peerWaId: string;
  // See InboundPayload.peerJid — same field, same purpose. Here the JID
  // identifies the recipient the operator was texting from their phone.
  peerJid?: string;
  body: string;
  previewLabel?: string | null;
  externalMessageId: string;
  sentAt?: string;
  rawHeaders?: Record<string, unknown> | null;
  attachments?: InboundAttachment[];
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
  ): Promise<Response> {
    const url = `${this.baseUrl}${path}`;
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${this.apiKey}`);
    if (init.body && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }
    const res = await fetch(url, { ...init, headers });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      this.log.warn(
        { status: res.status, path, body: text.slice(0, 500) },
        "[crm-client] non-OK response",
      );
    }
    return res;
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

  async postOutbound(p: OutboundPayload): Promise<void> {
    await this.fetch("/api/v1/inbox/whatsapp/baileys-outbound", {
      method: "POST",
      body: JSON.stringify(p),
    });
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
