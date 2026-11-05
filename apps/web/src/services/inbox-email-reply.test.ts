import { beforeEach, describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({
  select: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
  sendMail: vi.fn(),
  wartet: vi.fn(),
  notiz: vi.fn(),
  reihenfolge: [] as string[],
}));
vi.mock("@/db", () => ({ db: { select: mock.select, insert: mock.insert, update: mock.update } }));
vi.mock("nodemailer", () => ({ default: { createTransport: () => ({ sendMail: mock.sendMail }) } }));
vi.mock("imapflow", () => ({ ImapFlow: vi.fn() }));
vi.mock("mailparser", () => ({ simpleParser: vi.fn() }));
vi.mock("./workspace-settings", () => ({}));
vi.mock("@/lib/gmail/client", () => ({}));
vi.mock("./inbox-kleinanzeigen", () => ({ replyAddressForThread: (_t: unknown, email: string) => email }));
vi.mock("./inbox", () => ({}));
vi.mock("./activity-events", () => ({}));
vi.mock("./inbox-crm-link", () => ({}));
vi.mock("@/lib/identity/canonical", () => ({}));
vi.mock("./agent/agent-suppress", () => ({}));
vi.mock("./inbox-immoscout", () => ({}));
vi.mock("./immoscout-sync", () => ({}));
vi.mock("./lead-name", () => ({}));
vi.mock("./multi-company", () => ({}));
vi.mock("./deal-attribution", () => ({ noteOutboundToCustomer: mock.notiz, stampDealSourceIfEmpty: vi.fn() }));
vi.mock("./wartet", () => ({ aktualisiereWartet: mock.wartet }));
import { sendEmailReply } from "./inbox-email";

const konversation = { id: "conv", workspaceId: "ws", channelAccountId: "mailbox", contactId: "contact", dealRecordId: "deal", externalThreadId: "<t@x>", subject: "Umzug" };
const konto = { id: "mailbox", workspaceId: "ws", address: "office@example.invalid", channelType: "email", emailProvider: "imap_smtp", credential: "test-only" };
const kontakt = { id: "contact", email: "kunde@example.invalid" };

beforeEach(() => {
  vi.resetAllMocks();
  mock.reihenfolge.length = 0;
  const antworten = [[konversation], [konto], [kontakt]];
  let i = 0;
  mock.select.mockImplementation(() => ({ from: () => ({ where: () => ({ limit: () => Promise.resolve(antworten[i++] ?? []) }) }) }));
  mock.insert.mockReturnValue({ values: () => ({ returning: async () => (mock.reihenfolge.push("gespeichert"), [{ id: "msg" }]) }) });
  mock.update.mockReturnValue({ set: () => ({ where: async () => undefined }) });
  mock.sendMail.mockImplementation(async () => (mock.reihenfolge.push("gesendet"), { messageId: "<m@x>" }));
  mock.wartet.mockImplementation(async () => { mock.reihenfolge.push("wartet"); });
});

describe("sendEmailReply und Wartet-Signal", () => {
  it("rechnet das Signal nach dem gespeicherten Ausgang neu (auch für Agent-Antworten)", async () => {
    await expect(sendEmailReply({ conversationId: "conv", workspaceId: "ws", body: "Hallo" })).resolves.toEqual({ id: "msg" });
    expect(mock.wartet).toHaveBeenCalledWith("ws", "deal");
    expect(mock.reihenfolge).toEqual(["gesendet", "gespeichert", "wartet"]);
  });

  it("lässt den Versand nicht scheitern, wenn die Neuberechnung scheitert", async () => {
    mock.wartet.mockRejectedValue(new Error("db weg"));
    const fehler = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(sendEmailReply({ conversationId: "conv", workspaceId: "ws", body: "Hallo" })).resolves.toEqual({ id: "msg" });
    expect(fehler).toHaveBeenCalled();
    fehler.mockRestore();
  });

  it("rechnet nicht, wenn der Versand scheitert", async () => {
    mock.sendMail.mockRejectedValue(new Error("smtp weg"));
    await expect(sendEmailReply({ conversationId: "conv", workspaceId: "ws", body: "Hallo" })).rejects.toThrow("smtp weg");
    expect(mock.wartet).not.toHaveBeenCalled();
  });
});
