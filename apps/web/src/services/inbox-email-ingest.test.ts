import { beforeEach, describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({
  limit: vi.fn(),
  set: vi.fn(),
  parse: vi.fn(),
  push: vi.fn(),
  kontaktart: vi.fn(),
  inserts: [] as Record<string, unknown>[],
  pending: [] as Promise<unknown>[],
}));
vi.mock("@/db", () => ({
  db: {
    select: () => ({ from: () => ({ where: () => ({ limit: mock.limit }) }) }),
    update: () => ({ set: mock.set }),
    insert: () => ({
      values: (v: Record<string, unknown>) => {
        mock.inserts.push(v);
        return { returning: async () => [{ id: "message" }] };
      },
    }),
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
vi.mock("./kontaktart", () => ({ kontaktartFuerInboxKontakt: mock.kontaktart }));
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
  mock.inserts.length = 0;
  mock.kontaktart.mockResolvedValue("lead_kunde");
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

describe("neuer Thread einer Person mit bekannter Kontaktart", () => {
  function neueAnfrage() {
    return {
      ...antwort(),
      subject: "Frage zu Samstag",
      text: "Hallo, ich kann am Samstag leider nicht, ich bin krank.",
      messageId: "<neu@gmx.de>",
      inReplyTo: undefined,
    };
  }

  beforeEach(() => {
    mock.limit.mockReset();
    mock.limit
      .mockResolvedValueOnce([account])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: "contact", email: "anna.mueller@gmx.de" }])
      .mockResolvedValueOnce([]);
  });

  it("legt die Konversation eines Helfers in kein_lead an, ohne den Agenten zu wecken", async () => {
    mock.kontaktart.mockResolvedValue("team_helfer");
    mock.parse.mockResolvedValue(neueAnfrage());
    await syncChannelAccount("mailbox");
    await Promise.all(mock.pending);

    expect(mock.kontaktart).toHaveBeenCalledWith("contact");
    const konversation = mock.inserts.find((v) => "externalThreadId" in v);
    expect(konversation).toMatchObject({ lane: "kein_lead", kontaktart: "team_helfer", classifiedBy: "manual" });
    expect(konversation?.aiNeedsReply).not.toBe(true);
    // Die Krankmeldung klingelt trotzdem.
    expect(mock.push).toHaveBeenCalled();
  });

  it("lässt den Newsletter eines Partners in info, ohne Push", async () => {
    mock.kontaktart.mockResolvedValue("partner_vermittler");
    mock.parse.mockResolvedValue({
      ...neueAnfrage(),
      headers: new Map(Object.entries({ "list-unsubscribe": "<mailto:abmelden@partner.example>" })),
    });
    await syncChannelAccount("mailbox");
    await Promise.all(mock.pending);

    expect(mock.inserts.find((v) => "externalThreadId" in v)).toMatchObject({ lane: "info" });
    expect(mock.push).not.toHaveBeenCalled();
  });

  it("legt Nachrichten eines Kontakts mit Kontaktart Spam/Werbung still ab", async () => {
    mock.kontaktart.mockResolvedValue("spam_werbung");
    mock.parse.mockResolvedValue(neueAnfrage());
    await syncChannelAccount("mailbox");
    await Promise.all(mock.pending);

    expect(mock.inserts.find((v) => "externalThreadId" in v)).toMatchObject({ lane: "kein_lead" });
    expect(mock.push).not.toHaveBeenCalled();
  });

  it("legt eine echte Anfrage weiter in lead an und weckt den Agenten", async () => {
    mock.parse.mockResolvedValue(neueAnfrage());
    await syncChannelAccount("mailbox");
    await Promise.all(mock.pending);

    const konversation = mock.inserts.find((v) => "externalThreadId" in v);
    expect(konversation).toMatchObject({ lane: "lead", aiNeedsReply: true });
  });
});

describe("bestehender info-Thread einer Person mit bekannter Kontaktart", () => {
  beforeEach(() => {
    mock.limit.mockReset();
    mock.limit
      .mockResolvedValueOnce([account])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: "contact", email: "anna.mueller@gmx.de" }])
      .mockResolvedValueOnce([
        {
          ...crmKonversation,
          id: "conv-info",
          externalThreadId: "<alt@gmx.de>",
          classifiedBy: "heuristic",
          classificationReason: "Code-Nachricht",
          kontaktart: "team_helfer",
        },
      ]);
  });

  it("hebt eine echte Nachricht eines Helfers nach kein_lead und lässt sie klingeln", async () => {
    mock.kontaktart.mockResolvedValue("team_helfer");
    mock.parse.mockResolvedValue({
      ...antwort(),
      text: "Hallo, ich kann am Samstag leider nicht, ich bin krank.",
      inReplyTo: "<alt@gmx.de>",
    });
    await syncChannelAccount("mailbox");
    await Promise.all(mock.pending);

    expect(mock.set).toHaveBeenCalledWith(expect.objectContaining({ lane: "kein_lead", classifiedBy: "manual" }));
    expect(mock.push).toHaveBeenCalled();
  });
});
