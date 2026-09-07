import { beforeEach, describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ context: vi.fn(), document: vi.fn(), resolve: vi.fn(), send: vi.fn(), select: vi.fn(), insert: vi.fn(), update: vi.fn() }));
vi.mock("@/db", () => ({ db: { select: mock.select, insert: mock.insert, update: mock.update } }));
vi.mock("./customer-portal-data", () => ({ loadContextByToken: mock.context, getScopedDocument: mock.document }));
vi.mock("./customer-portal-emails", () => ({ resolveCustomerEmailTransport: mock.resolve }));
vi.mock("./inbox-email", () => ({ sendNewEmail: mock.send }));
import { sendPortalDocumentEmail } from "./customer-portal-document-email";

const token = "test-token";
const ctx = { meta: { revoked: false, featureDisabled: false }, dealNumber: "TEST-123", documents: { quotationUrl: `/api/public/${token}/documents/quote`, orderConfirmationUrl: null, invoiceUrl: null } };
const returning = vi.fn();
const updateWhere = vi.fn();
beforeEach(() => {
  vi.resetAllMocks();
  mock.context.mockResolvedValue(structuredClone(ctx));
  mock.document.mockResolvedValue({ mimeType: "application/pdf", fileName: "Angebot.pdf", fileContent: Buffer.from("%PDF-1.7\nfixture").toString("base64") });
  mock.resolve.mockResolvedValue({ ok: true, customerEmail: "stored@example.invalid", account: { id: "company-mailbox" }, branding: { displayName: "Test Umzüge" } });
  mock.select.mockReturnValue({ from: () => ({ where: () => ({ limit: async () => [{ workspaceId: "workspace", dealRecordId: "deal" }] }) }) });
  returning.mockResolvedValue([{ dealRecordId: "deal" }]);
  mock.insert.mockReturnValue({ values: () => ({ onConflictDoUpdate: () => ({ returning }) }) });
  updateWhere.mockResolvedValue(undefined);
  mock.update.mockReturnValue({ set: () => ({ where: updateWhere }) });
  mock.send.mockResolvedValue({ conversationId: "conversation" });
});

describe("portal document delivery", () => {
  it("sends the scoped binary PDF to the stored recipient through the company's mailbox", async () => {
    expect(await sendPortalDocumentEmail(token, "quote")).toEqual({ ok: true });
    expect(mock.document).toHaveBeenCalledWith(token, "quote");
    expect(mock.resolve).toHaveBeenCalledWith("workspace", "deal", true);
    expect(mock.send).toHaveBeenCalledWith(expect.objectContaining({ to: "stored@example.invalid", channelAccountId: "company-mailbox", dealRecordId: "deal", attachments: [{ filename: "Angebot.pdf", contentType: "application/pdf", content: Buffer.from("%PDF-1.7\nfixture") }] }));
  });
  it.each([null, { ...ctx, meta: { revoked: true } }, { ...ctx, meta: { featureDisabled: true } }])("rejects unusable links before resolving a recipient", async context => {
    mock.context.mockResolvedValue(context);
    expect(await sendPortalDocumentEmail(token, "quote")).toEqual({ ok: false, reason: "unavailable" });
    expect(mock.resolve).not.toHaveBeenCalled();
    expect(mock.send).not.toHaveBeenCalled();
  });
  it("rejects documents from another deal and superseded PDFs", async () => {
    expect(await sendPortalDocumentEmail(token, "other")).toEqual({ ok: false, reason: "document_unavailable" });
    expect(mock.document).not.toHaveBeenCalled();
  });
  it("rejects missing or invalid PDFs", async () => {
    mock.document.mockResolvedValue(null);
    expect((await sendPortalDocumentEmail(token, "quote"))).toEqual({ ok: false, reason: "document_unavailable" });
    mock.document.mockResolvedValue({ mimeType: "application/pdf", fileName: "bad.pdf", fileContent: Buffer.from("not pdf").toString("base64") });
    expect((await sendPortalDocumentEmail(token, "quote"))).toEqual({ ok: false, reason: "document_unavailable" });
    expect(mock.send).not.toHaveBeenCalled();
  });
  it("requires a usable customer address and configured transport", async () => {
    mock.resolve.mockResolvedValue({ ok: false, reason: "no_customer_email" });
    expect(await sendPortalDocumentEmail(token, "quote")).toEqual({ ok: false, reason: "no_customer_email" });
    expect(mock.insert).not.toHaveBeenCalled();
  });
  it("does not send when the atomic claim is rejected", async () => {
    returning.mockResolvedValue([]);
    expect(await sendPortalDocumentEmail(token, "quote")).toEqual({ ok: false, reason: "rate_limited" });
    expect(mock.send).not.toHaveBeenCalled();
  });
  it("reports provider errors without leaking credentials or raw errors", async () => {
    mock.send.mockRejectedValue(new Error("private transport details"));
    expect(await sendPortalDocumentEmail(token, "quote")).toEqual({ ok: false, reason: "send_failed" });
  });
  it("keeps success when bookkeeping fails after the provider accepted the email", async () => {
    updateWhere.mockRejectedValue(new Error("database unavailable"));
    expect(await sendPortalDocumentEmail(token, "quote")).toEqual({ ok: true });
    expect(mock.send).toHaveBeenCalledTimes(1);
  });
});
