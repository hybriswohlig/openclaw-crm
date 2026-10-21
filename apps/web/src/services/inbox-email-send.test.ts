import { beforeEach, describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ select: vi.fn(), insert: vi.fn(), update: vi.fn(), sendMail: vi.fn(), gmailSend: vi.fn(), secret: vi.fn() }));
vi.mock("@/db", () => ({ db: { select: mock.select, insert: mock.insert, update: mock.update } }));
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
import { EmailUserError, sendEmailReply, sendNewEmail } from "./inbox-email";
import { EMAIL_REPLY_NO_RECIPIENT } from "./email-reply-recipient";

let account: Record<string, unknown>;
let selectQueue: unknown[][] | null = null;
const values = vi.fn();
const input = { workspaceId: "workspace", channelAccountId: "mailbox", to: "customer@example.invalid", subject: "Ihr Angebot", body: "Anbei Ihr PDF.", dealRecordId: "deal", attachments: [{ filename: "Angebot.pdf", contentType: "application/pdf", content: Buffer.from("%PDF-1.7\nattachment-test") }] };
beforeEach(() => {
  vi.resetAllMocks();
  selectQueue = null;
  account = { id: "mailbox", workspaceId: "workspace", address: "office@example.invalid", channelType: "email", emailProvider: "imap_smtp", isActive: true, credential: "test-only" };
  let selectCount = 0;
  mock.select.mockImplementation(() => {
    const rows = selectQueue ? (selectQueue.shift() ?? []) : (++selectCount === 1 ? [account] : [{ id: "contact" }]);
    const limited = { limit: async () => rows };
    return { from: () => ({ where: () => ({ ...limited, orderBy: () => limited }) }) };
  });
  values.mockReturnValue({ returning: async () => [{ id: "stored" }] });
  mock.insert.mockReturnValue({ values });
  mock.update.mockImplementation(() => ({ set: () => ({ where: async () => undefined }) }));
  mock.sendMail.mockResolvedValue({});
  mock.gmailSend.mockResolvedValue({});
  mock.secret.mockResolvedValue("test-refresh");
});

const BARIS = "xbariskaya@gmail.com";
const BARIS_MESSAGE_ID = "<CABcExampleId123@mail.gmail.com>";

function queueReply(opts: {
  provider: "imap_smtp" | "gmail_api";
  threadId: string;
  from: string | null;
  contact: string | null;
  own?: string;
}) {
  account.emailProvider = opts.provider;
  account.address = opts.own ?? "office@kottke.example";
  account.credential = opts.provider === "gmail_api" ? null : "test-only";
  selectQueue = [
    [{
      id: "conv-baris",
      workspaceId: "workspace",
      channelAccountId: "mailbox",
      contactId: "contact-baris",
      externalThreadId: opts.threadId,
      subject: "Umzugsanfrage",
      dealRecordId: null,
    }],
    [account],
    [{ id: "contact-baris", email: opts.contact }],
    [{
      fromAddress: opts.from,
      externalMessageId: BARIS_MESSAGE_ID,
      rawHeaders: JSON.stringify({
        from: opts.from ? `Baris Kaya <${opts.from}>` : BARIS_MESSAGE_ID,
        "message-id": BARIS_MESSAGE_ID,
        references: `<earlier@mail.gmail.com> ${BARIS_MESSAGE_ID}`,
      }),
    }],
    [],
  ];
}
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

describe("email reply recipient", () => {
  it("sends the Baris Kaya SMTP reply to the customer and threads on the Message-ID", async () => {
    queueReply({ provider: "imap_smtp", threadId: BARIS_MESSAGE_ID, from: BARIS, contact: BARIS });
    await sendEmailReply({ conversationId: "conv-baris", workspaceId: "workspace", body: "Guten Tag Herr Kaya" });
    expect(mock.sendMail).toHaveBeenCalledWith(expect.objectContaining({
      to: BARIS,
      headers: {
        "In-Reply-To": BARIS_MESSAGE_ID,
        References: `<earlier@mail.gmail.com> ${BARIS_MESSAGE_ID}`,
      },
    }));
    expect(mock.gmailSend).not.toHaveBeenCalled();
    const sentTo = mock.sendMail.mock.calls[0][0].to as string;
    expect(sentTo).not.toContain("mail.gmail.com");
    expect(sentTo).not.toMatch(/[<>]/);
  });

  it("does not address a Gmail API reply to a Message-ID thread key", async () => {
    queueReply({ provider: "gmail_api", threadId: BARIS_MESSAGE_ID, from: BARIS, contact: BARIS });
    await sendEmailReply({ conversationId: "conv-baris", workspaceId: "workspace", body: "Guten Tag Herr Kaya" });
    const request = mock.gmailSend.mock.calls[0][0].requestBody;
    expect(request.threadId).toBeUndefined();
    const mime = Buffer.from(request.raw, "base64url").toString();
    expect(mime).toMatch(/(^|\n)To: xbariskaya@gmail.com\r?\n/);
    expect(mime).toMatch(/In-Reply-To: <CABcExampleId123@mail.gmail.com>/);
    expect(mime).not.toMatch(/(^|\n)To:[^\r\n]*mail\.gmail\.com/);
    expect(mock.sendMail).not.toHaveBeenCalled();
  });

  it("builds a Gmail MIME reply to the customer, with the thread id only when it is a Gmail id", async () => {
    queueReply({ provider: "gmail_api", threadId: "18f3ab90c1d2e4f6", from: BARIS, contact: BARIS });
    await sendEmailReply({ conversationId: "conv-baris", workspaceId: "workspace", body: "Guten Tag Herr Kaya" });
    const request = mock.gmailSend.mock.calls[0][0].requestBody;
    expect(request.threadId).toBe("18f3ab90c1d2e4f6");
    const mime = Buffer.from(request.raw, "base64url").toString();
    expect(mime).toMatch(/(^|\n)To: xbariskaya@gmail.com\r?\n/);
    expect(mime).toMatch(/In-Reply-To: <CABcExampleId123@mail.gmail.com>/);
    expect(mime).not.toMatch(/(^|\n)To:[^\r\n]*mail\.gmail\.com/);
    expect(mock.sendMail).not.toHaveBeenCalled();
  });

  it("does not send when the only address is the Message-ID", async () => {
    queueReply({ provider: "imap_smtp", threadId: BARIS_MESSAGE_ID, from: null, contact: null });
    const err = await sendEmailReply({
      conversationId: "conv-baris",
      workspaceId: "workspace",
      body: "Guten Tag",
    }).catch((caught: unknown) => caught);
    expect(err).toBeInstanceOf(EmailUserError);
    expect((err as Error).message).toBe(EMAIL_REPLY_NO_RECIPIENT);
    expect(mock.sendMail).not.toHaveBeenCalled();
    expect(mock.gmailSend).not.toHaveBeenCalled();
    expect(mock.insert).not.toHaveBeenCalled();
  });
});
