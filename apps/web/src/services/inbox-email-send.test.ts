import { beforeEach, describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ select: vi.fn(), insert: vi.fn(), sendMail: vi.fn(), gmailSend: vi.fn(), secret: vi.fn() }));
vi.mock("@/db", () => ({ db: { select: mock.select, insert: mock.insert } }));
vi.mock("nodemailer", () => ({ default: { createTransport: () => ({ sendMail: mock.sendMail }) } }));
vi.mock("imapflow", () => ({ ImapFlow: vi.fn() }));
vi.mock("mailparser", () => ({ simpleParser: vi.fn() }));
vi.mock("./workspace-settings", () => ({ getSecret: mock.secret }));
vi.mock("@/lib/gmail/client", () => ({ gmailFromRefreshToken: () => ({ users: { messages: { send: mock.gmailSend } } }) }));
vi.mock("./inbox-kleinanzeigen", () => ({}));
vi.mock("./inbox", () => ({}));
vi.mock("./activity-events", () => ({}));
vi.mock("./inbox-crm-link", () => ({}));
vi.mock("@/lib/identity/canonical", () => ({}));
vi.mock("./inbox-triage", () => ({}));
vi.mock("./agent/agent-suppress", () => ({}));
vi.mock("./inbox-immoscout", () => ({}));
vi.mock("./immoscout-sync", () => ({}));
vi.mock("./lead-name", () => ({}));
vi.mock("./multi-company", () => ({}));
import { sendNewEmail } from "./inbox-email";

let account: Record<string, unknown>;
const values = vi.fn();
const input = { workspaceId: "workspace", channelAccountId: "mailbox", to: "customer@example.invalid", subject: "Ihr Angebot", body: "Anbei Ihr PDF.", dealRecordId: "deal", attachments: [{ filename: "Angebot.pdf", contentType: "application/pdf", content: Buffer.from("%PDF-1.7\nattachment-test") }] };
beforeEach(() => {
  vi.resetAllMocks();
  account = { id: "mailbox", workspaceId: "workspace", address: "office@example.invalid", channelType: "email", emailProvider: "imap_smtp", isActive: true, credential: "test-only" };
  let selectCount = 0;
  mock.select.mockImplementation(() => ({ from: () => ({ where: () => ({ limit: async () => ++selectCount === 1 ? [account] : [{ id: "contact" }] }) }) }));
  values.mockReturnValue({ returning: async () => [{ id: "stored" }] });
  mock.insert.mockReturnValue({ values });
  mock.sendMail.mockResolvedValue({});
  mock.gmailSend.mockResolvedValue({});
  mock.secret.mockResolvedValue("test-refresh");
});
describe("new CRM email with binary attachments", () => {
  it("sends the attachment via SMTP and persists it with the deal", async () => {
    expect(await sendNewEmail(input)).toEqual({ conversationId: "stored" });
    expect(mock.sendMail).toHaveBeenCalledWith(expect.objectContaining({ attachments: input.attachments, to: input.to }));
    expect(values).toHaveBeenCalledWith(expect.objectContaining({ dealRecordId: "deal", fileContent: input.attachments[0].content.toString("base64"), mimeType: "application/pdf" }));
  });
  it("builds an actual MIME attachment for Gmail API without an SMTP credential", async () => {
    account.emailProvider = "gmail_api"; account.credential = null;
    await sendNewEmail(input);
    const mime = Buffer.from(mock.gmailSend.mock.calls[0][0].requestBody.raw, "base64url").toString();
    expect(mime).toContain("Content-Type: multipart/mixed");
    expect(mime).toContain('filename=Angebot.pdf');
    expect(mime).toContain(input.attachments[0].content.toString("base64"));
    expect(mock.sendMail).not.toHaveBeenCalled();
  });
  it("rejects inactive accounts and oversized attachments before sending", async () => {
    account.isActive = false;
    await expect(sendNewEmail(input)).rejects.toThrow("Kein gültiges E-Mail-Konto");
    await expect(sendNewEmail({ ...input, attachments: [{ ...input.attachments[0], content: Buffer.alloc(10 * 1024 * 1024 + 1) }] })).rejects.toThrow("Anhänge sind zu groß");
    expect(mock.sendMail).not.toHaveBeenCalled();
  });
  it("does not create an inbox record on transport failure", async () => {
    mock.sendMail.mockRejectedValue(new Error("provider unavailable"));
    await expect(sendNewEmail(input)).rejects.toThrow("provider unavailable");
    expect(mock.insert).not.toHaveBeenCalled();
  });
});
