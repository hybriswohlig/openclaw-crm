import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getAuthContext: vi.fn(),
  send: vi.fn(),
  docs: vi.fn(),
  supersede: vi.fn(),
}));

vi.mock("@/lib/api-utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-utils")>();
  return { ...actual, getAuthContext: mocks.getAuthContext };
});

vi.mock("@/services/inbox-whatsapp", () => {
  class BaileysMediaTooLargeError extends Error {}
  class BaileysBridgeNotConfiguredError extends Error {}
  class BaileysBridgeError extends Error {
    status = 502;
  }
  return {
    sendBaileysFirstMessage: (...args: unknown[]) => mocks.send(...args),
    BaileysMediaTooLargeError,
    BaileysBridgeNotConfiguredError,
    BaileysBridgeError,
  };
});

vi.mock("@/services/baileys-document-send", () => ({
  sendBaileysOpeningDocuments: (...args: unknown[]) => mocks.docs(...args),
}));

vi.mock("@/services/agent/draft-schliessen", () => ({
  supersedePendingDrafts: (...args: unknown[]) => mocks.supersede(...args),
}));

import { POST } from "./route";

function send(body: Record<string, unknown>) {
  return POST(
    new NextRequest("https://crm.test/api/v1/inbox/whatsapp/send-baileys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getAuthContext.mockResolvedValue({
    userId: "usr_dario",
    workspaceId: "ws_kottke",
    workspaceRole: "admin",
    permissions: {},
    authMethod: "session",
  });
  mocks.send.mockResolvedValue({ conversationId: "conv-new", message: { id: "m1" } });
  mocks.supersede.mockResolvedValue(1);
});

describe("POST send-baileys", () => {
  it("supersedes pending drafts for the new conversation and the deal", async () => {
    const res = await send({
      channelAccountId: "ch-1",
      toPhone: "+491701234567",
      customerName: "Anna",
      body: "Guten Tag",
      dealRecordId: "deal-9",
    });
    expect(res.status).toBe(200);
    expect(mocks.supersede).toHaveBeenCalledWith({
      workspaceId: "ws_kottke",
      conversationId: "conv-new",
      dealRecordId: "deal-9",
      userId: "usr_dario",
      supersededBy: "manual_send",
    });
  });

  it("does not close drafts when the first message fails", async () => {
    mocks.send.mockRejectedValue(new Error("bridge down"));
    const res = await send({
      channelAccountId: "ch-1",
      toPhone: "+491701234567",
      body: "Guten Tag",
      dealRecordId: "deal-9",
    });
    expect(res.status).toBe(500);
    expect(mocks.supersede).not.toHaveBeenCalled();
  });

  it("sends opening documents without requiring a text body", async () => {
    mocks.docs.mockResolvedValue({
      conversationId: "conv-doc",
      message: { id: "m-doc" },
      messages: [{ id: "m-doc" }],
      deduped: false,
    });
    const res = await send({
      channelAccountId: "ch-1",
      toPhone: "+491701234567",
      dealRecordId: "deal-9",
      attachments: [{ dealDocumentId: "doc-9" }],
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      data: { conversationId: "conv-doc", deduped: false, messageId: "m-doc" },
    });
    expect(mocks.send).not.toHaveBeenCalled();
    expect(mocks.docs).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: "ws_kottke",
        channelAccountId: "ch-1",
        dealRecordId: "deal-9",
        body: "",
        attachments: [{ kind: "dealDocument", dealDocumentId: "doc-9" }],
      })
    );
    expect(mocks.supersede).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: "conv-doc", dealRecordId: "deal-9" })
    );
  });
});
