import { beforeEach, describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ limit: vi.fn(), set: vi.fn(), parse: vi.fn(), push: vi.fn(), pending: [] as Promise<unknown>[] }));
vi.mock("@/db", () => ({
  db: {
    select: () => ({ from: () => ({ where: () => ({ limit: mock.limit }) }) }),
    update: () => ({ set: mock.set }),
    insert: () => ({ values: () => ({ returning: async () => [{ id: "message" }] }) }),
  },
}));
vi.mock("imapflow", () => ({
  ImapFlow: class {
    on() {}
    async connect() {}
    async getMailboxLock() { return { release() {} }; }
    async *fetch() { yield { uid: 7, source: Buffer.from("raw") }; }
    async logout() {}
    close() {}
  },
}));
vi.mock("mailparser", () => ({ simpleParser: mock.parse }));
vi.mock("nodemailer", () => ({ default: {} }));
vi.mock("@vercel/functions", () => ({ waitUntil: (p: Promise<unknown>) => mock.pending.push(p) }));
vi.mock("./push", () => ({ sendPush: mock.push }));
vi.mock("./inbox-kleinanzeigen", () => ({ isKleinanzeigenEmail: () => false }));
vi.mock("./inbox-immoscout", () => ({ isImmoscoutLeadEmail: () => false }));
vi.mock("./inbox-crm-link", () => ({ ensureCrmPerson: vi.fn() }));
vi.mock("./agent/agent-suppress", () => ({ looksDeclined: () => false }));
vi.mock("./activity-events", () => ({ emitEvent: vi.fn() }));
vi.mock("./multi-company", () => ({ recomputeMultiCompanyForContact: vi.fn() }));
vi.mock("./inbox", () => ({}));
vi.mock("@/lib/identity/canonical", () => ({}));
vi.mock("./workspace-settings", () => ({}));
vi.mock("./immoscout-sync", () => ({}));
vi.mock("./lead-name", () => ({}));
import { syncChannelAccount } from "./inbox-email";
import { VOM_CRM_GESTARTET_GRUND } from "./inbox-triage";

// KVA-Bestätigung, Portal-Dokument und Widerruf gehen über sendNewEmail raus
// und bitten den Kunden, auf die Mail zu antworten. Über IMAP findet die Antwort
// per In-Reply-To die info-Konversation, die sendNewEmail angelegt hat.
const account = { id: "mailbox", workspaceId: "workspace", address: "office@example.invalid", channelType: "email", emailProvider: "imap_smtp", credential: "test-only", isActive: true, lastSyncUid: 0 };
const crmKonversation = {
  id: "conv-crm", workspaceId: "workspace", channelAccountId: "mailbox", contactId: "contact", dealRecordId: "deal",
  externalThreadId: "<kva@example.invalid>", status: "open", unreadCount: 0,
  lane: "info", classifiedBy: "manual", classificationReason: VOM_CRM_GESTARTET_GRUND,
};
function antwort(headers: Record<string, string> = {}) {
  return {
    from: { value: [{ name: "Anna Müller", address: "anna.mueller@gmx.de" }] },
    subject: "Re: Bestätigung Ihres Auftrags",
    text: "Danke für die Bestätigung. Kommen Sie am Freitag schon um 8 Uhr?",
    messageId: "<antwort@gmx.de>",
    inReplyTo: "<kva@example.invalid>",
    date: new Date("2026-10-08T10:00:00Z"),
    headers: new Map(Object.entries(headers)),
    attachments: [],
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  mock.pending.length = 0;
  mock.set.mockReturnValue({ where: async () => undefined });
  // Reihenfolge der Abfragen: Konto, Dublette, Kontakt, Konversation
  mock.limit
    .mockResolvedValueOnce([account])
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([{ id: "contact", email: "anna.mueller@gmx.de" }])
    .mockResolvedValueOnce([crmKonversation]);
});

describe("IMAP-Antwort auf eine vom CRM gestartete Mail", () => {
  it("pusht die echte Antwort des Kunden, die Konversation bleibt in info", async () => {
    mock.parse.mockResolvedValue(antwort());
    await syncChannelAccount("mailbox");
    await Promise.all(mock.pending);
    expect(mock.push).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Anna Müller", url: "/inbox?conv=conv-crm" }),
      { workspaceId: "workspace" }
    );
    expect(mock.set).toHaveBeenCalledWith(expect.objectContaining({ unreadCount: 1 }));
    expect(mock.set.mock.calls.some(([v]) => "lane" in v)).toBe(false);
  });

  it("pusht keine Abwesenheitsnotiz", async () => {
    mock.parse.mockResolvedValue(antwort({ "auto-submitted": "auto-replied" }));
    await syncChannelAccount("mailbox");
    await Promise.all(mock.pending);
    expect(mock.set).toHaveBeenCalledWith(expect.objectContaining({ unreadCount: 1 }));
    expect(mock.push).not.toHaveBeenCalled();
  });
});
