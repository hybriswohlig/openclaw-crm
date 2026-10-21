import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => {
  class EmailUserError extends Error {
    constructor(message: string) {
      super(message);
      this.name = "EmailUserError";
    }
  }
  return {
    getAuthContext: vi.fn(),
    limit: vi.fn(),
    sendBaileysReply: vi.fn(),
    sendWhatsAppReply: vi.fn(),
    sendEmailReply: vi.fn(),
    documents: vi.fn(),
    setHumanOwned: vi.fn(),
    supersede: vi.fn(),
    updates: [] as Record<string, unknown>[],
    EmailUserError,
  };
});

vi.mock("@/lib/api-utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-utils")>();
  return { ...actual, getAuthContext: mocks.getAuthContext };
});

vi.mock("@/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        innerJoin: () => ({
          where: () => ({ limit: mocks.limit }),
        }),
      }),
    }),
    update: () => ({
      set: (value: Record<string, unknown>) => {
        mocks.updates.push(value);
        return { where: async () => undefined };
      },
    }),
  },
}));

vi.mock("@/services/inbox", () => ({
  getMessages: vi.fn(),
  markConversationRead: vi.fn(),
}));

vi.mock("@/services/inbox-email", () => ({
  sendEmailReply: (...args: unknown[]) => mocks.sendEmailReply(...args),
  EmailUserError: mocks.EmailUserError,
}));

vi.mock("@/services/inbox-whatsapp", () => {
  class WhatsAppSessionExpiredError extends Error {}
  class BaileysBridgeNotConfiguredError extends Error {}
  class BaileysBridgeError extends Error {
    status = 502;
  }
  class BaileysMediaTooLargeError extends Error {}
  return {
    sendWhatsAppReply: (...args: unknown[]) => mocks.sendWhatsAppReply(...args),
    sendBaileysReply: (...args: unknown[]) => mocks.sendBaileysReply(...args),
    WhatsAppSessionExpiredError,
    BaileysBridgeNotConfiguredError,
    BaileysBridgeError,
    BaileysMediaTooLargeError,
  };
});

vi.mock("@/services/baileys-document-send", () => ({
  sendConversationDocuments: (...args: unknown[]) => mocks.documents(...args),
}));

vi.mock("@/services/agent/agent-gate", () => ({
  setHumanOwned: (...args: unknown[]) => mocks.setHumanOwned(...args),
}));

vi.mock("@/services/agent/draft-schliessen", () => ({
  supersedePendingDrafts: (...args: unknown[]) => mocks.supersede(...args),
}));

import { POST } from "./route";

const CONV = "6e9256ac-a253-4b4e-b49d-0a7845e9f940";

function send(body: string | Record<string, unknown>) {
  return POST(
    new NextRequest(`https://crm.test/api/v1/inbox/conversations/${CONV}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(typeof body === "string" ? { body } : body),
    }),
    { params: Promise.resolve({ id: CONV }) }
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.updates = [];
  mocks.getAuthContext.mockResolvedValue({
    userId: "usr_dario",
    workspaceId: "ws_kottke",
    workspaceRole: "admin",
    permissions: {},
    authMethod: "session",
  });
  mocks.limit.mockResolvedValue([
    {
      channelType: "whatsapp",
      waPhoneNumberId: null,
      baileysBridgeProvider: "inhouse",
      dealRecordId: "deal-1",
    },
  ]);
  mocks.sendBaileysReply.mockResolvedValue({ id: "msg-1" });
  mocks.supersede.mockResolvedValue(1);
  mocks.setHumanOwned.mockResolvedValue(undefined);
});

describe("POST conversation message", () => {
  it("supersedes pending drafts for the conversation and the deal after a manual send", async () => {
    const res = await send("Ich schreibe selbst.");
    expect(res.status).toBe(200);
    expect(mocks.supersede).toHaveBeenCalledWith({
      workspaceId: "ws_kottke",
      conversationId: CONV,
      dealRecordId: "deal-1",
      userId: "usr_dario",
      supersededBy: "manual_send",
    });
    expect(mocks.setHumanOwned).toHaveBeenCalledWith("ws_kottke", "deal-1", "usr_dario");
    expect(mocks.updates[0]).toMatchObject({ aiPaused: true, aiNeedsReply: false });
  });

  it("does not close drafts when the send fails", async () => {
    mocks.sendBaileysReply.mockRejectedValue(new Error("bridge down"));
    const res = await send("kommt nicht an");
    expect(res.status).toBe(500);
    expect(mocks.supersede).not.toHaveBeenCalled();
    expect(mocks.setHumanOwned).not.toHaveBeenCalled();
  });

  it("rejects documents unless the thread is in-house Baileys", async () => {
    mocks.limit.mockResolvedValue([
      {
        channelType: "email",
        waPhoneNumberId: null,
        baileysBridgeProvider: null,
        dealRecordId: "deal-1",
      },
    ]);
    const res = await send({
      body: "siehe Anhang",
      attachments: [{ dealDocumentId: "doc-1" }],
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("BAILEYS_DOCUMENTS_ONLY");
    expect(mocks.documents).not.toHaveBeenCalled();
    expect(mocks.sendEmailReply).not.toHaveBeenCalled();
  });

  it("sends a deal document on the Baileys thread and still takes the deal over", async () => {
    mocks.documents.mockResolvedValue({
      message: { id: "msg-doc" },
      messages: [{ id: "msg-doc" }],
      deduped: false,
      conversationId: CONV,
    });
    const res = await send({
      attachments: [{ dealDocumentId: "doc-1", filename: "Angebot.pdf" }],
      idempotencyKey: "send-1",
    });
    expect(res.status).toBe(200);
    expect(mocks.documents).toHaveBeenCalledWith({
      conversationId: CONV,
      workspaceId: "ws_kottke",
      dealRecordId: "deal-1",
      body: "",
      attachments: [{ kind: "dealDocument", dealDocumentId: "doc-1", filename: "Angebot.pdf" }],
      bodyDelivery: undefined,
      idempotencyKey: "send-1",
    });
    expect(mocks.sendBaileysReply).not.toHaveBeenCalled();
    expect(mocks.setHumanOwned).toHaveBeenCalledWith("ws_kottke", "deal-1", "usr_dario");
  });

  it("aborts an email reply when the recipient is not a customer address", async () => {
    mocks.limit.mockResolvedValue([
      {
        channelType: "email",
        waPhoneNumberId: null,
        baileysBridgeProvider: null,
        dealRecordId: "deal-1",
      },
    ]);
    mocks.sendEmailReply.mockRejectedValue(
      new mocks.EmailUserError(
        "Kein gültiger Empfänger. Antworten gehen nur an die Kunden-E-Mail (Reply-To oder From der letzten eingehenden Nachricht), nie an eine Message-ID und nie an die eigene Adresse. Versand abgebrochen."
      )
    );
    const res = await send("Kurze Rückmeldung zum Umzug.");
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.message).toMatch(/Message-ID/);
    expect(body.error.message).toMatch(/abgebrochen/i);
    expect(mocks.supersede).not.toHaveBeenCalled();
    expect(mocks.setHumanOwned).not.toHaveBeenCalled();
  });
});
