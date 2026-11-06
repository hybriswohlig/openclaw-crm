import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getAuthContext: vi.fn(),
  limit: vi.fn(),
  sendBaileysReply: vi.fn(),
  sendWhatsAppReply: vi.fn(),
  sendEmailReply: vi.fn(),
  documents: vi.fn(),
  setHumanOwned: vi.fn(),
  supersede: vi.fn(),
  letzteEigene: vi.fn(),
  updates: [] as Record<string, unknown>[],
  updateFehler: null as Error | null,
}));

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
        return {
          where: async () => {
            if (mocks.updateFehler) throw mocks.updateFehler;
          },
        };
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

vi.mock("@/services/wartet", () => ({
  setzeLetzteEigeneNachricht: (...args: unknown[]) => mocks.letzteEigene(...args),
}));

import { POST } from "./route";
import {
  WhatsAppSessionExpiredError,
  BaileysBridgeNotConfiguredError,
  BaileysBridgeError,
  BaileysMediaTooLargeError,
} from "@/services/inbox-whatsapp";
import { WhatsAppDocumentInputError } from "@/services/whatsapp-document";

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
  mocks.letzteEigene.mockResolvedValue(undefined);
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

  it("merkt die eigene Nachricht mit der gespeicherten Sendezeit", async () => {
    const gesendet = new Date("2026-11-05T09:15:00Z");
    mocks.sendBaileysReply.mockResolvedValue({ id: "msg-1", sentAt: gesendet });
    const res = await send("Ich schreibe selbst.");
    expect(res.status).toBe(200);
    expect(mocks.letzteEigene).toHaveBeenCalledWith("deal-1", gesendet);
  });

  it("setzt bei einem wiederholten (deduplizierten) Dokumentversand keine neue eigene Nachricht", async () => {
    mocks.documents.mockResolvedValue({
      message: { id: "msg-doc", sentAt: new Date("2026-11-01T08:00:00Z") },
      messages: [{ id: "msg-doc" }],
      deduped: true,
      conversationId: CONV,
    });
    const res = await send({
      attachments: [{ dealDocumentId: "doc-1", filename: "Angebot.pdf" }],
      idempotencyKey: "send-1",
    });
    expect(res.status).toBe(200);
    expect(mocks.letzteEigene).not.toHaveBeenCalled();
  });

  it("nimmt beim frischen Dokumentversand die Sendezeit der Nachricht", async () => {
    const gesendet = new Date("2026-11-05T10:00:00Z");
    mocks.documents.mockResolvedValue({
      message: { id: "msg-doc", sentAt: gesendet },
      messages: [{ id: "msg-doc" }],
      deduped: false,
      conversationId: CONV,
    });
    const res = await send({ attachments: [{ dealDocumentId: "doc-1" }], idempotencyKey: "send-2" });
    expect(res.status).toBe(200);
    expect(mocks.letzteEigene).toHaveBeenCalledWith("deal-1", gesendet);
  });
});

// Die Fehlerklassen sind oben gemockt und nehmen nur eine Meldung.
function fehler(Klasse: unknown, meldung: string): Error {
  return new (Klasse as new (message: string) => Error)(meldung);
}

// Festgehaltene Antworten der Route (Task 5, Schritt 1): Codes, Status und
// Körper müssen nach dem Umbau auf services/inbox-senden gleich bleiben.
describe("POST conversation message · festgehaltene Antworten", () => {
  function kanal(row: Record<string, unknown>) {
    mocks.limit.mockResolvedValue([{ dealRecordId: "deal-1", ...row }]);
  }

  function keineNebenwirkungen() {
    expect(mocks.updates).toEqual([]);
    expect(mocks.letzteEigene).not.toHaveBeenCalled();
    expect(mocks.supersede).not.toHaveBeenCalled();
    expect(mocks.setHumanOwned).not.toHaveBeenCalled();
  }

  it("Text über Baileys: Körper getrimmt, Antwort { data: Nachricht }", async () => {
    const res = await send("  Hallo  ");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: { id: "msg-1" } });
    expect(mocks.sendBaileysReply).toHaveBeenCalledWith({
      conversationId: CONV,
      workspaceId: "ws_kottke",
      body: "Hallo",
    });
    expect(mocks.sendWhatsAppReply).not.toHaveBeenCalled();
    expect(mocks.sendEmailReply).not.toHaveBeenCalled();
  });

  it("Baileys ohne gespeicherte Zeile: 200 mit data null, Nebenwirkungen laufen", async () => {
    mocks.sendBaileysReply.mockResolvedValue(null);
    const res = await send("Hallo");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: null });
    expect(mocks.updates[0]).toMatchObject({ aiPaused: true, aiNeedsReply: false });
    expect(mocks.letzteEigene).toHaveBeenCalledWith("deal-1", expect.any(Date));
    expect(mocks.setHumanOwned).toHaveBeenCalledOnce();
  });

  it("Text über WABA", async () => {
    kanal({ channelType: "whatsapp", waPhoneNumberId: "pn-1", baileysBridgeProvider: null });
    mocks.sendWhatsAppReply.mockResolvedValue({ id: "msg-wa" });
    const res = await send(" Guten Tag ");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: { id: "msg-wa" } });
    expect(mocks.sendWhatsAppReply).toHaveBeenCalledWith({
      conversationId: CONV,
      workspaceId: "ws_kottke",
      body: "Guten Tag",
    });
    expect(mocks.sendBaileysReply).not.toHaveBeenCalled();
    expect(mocks.letzteEigene).toHaveBeenCalledWith("deal-1", expect.any(Date));
  });

  it("Text per E-Mail", async () => {
    kanal({ channelType: "email", waPhoneNumberId: null, baileysBridgeProvider: null });
    mocks.sendEmailReply.mockResolvedValue({ id: "msg-mail" });
    const res = await send("Hallo per Mail ");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: { id: "msg-mail" } });
    expect(mocks.sendEmailReply).toHaveBeenCalledWith({
      conversationId: CONV,
      workspaceId: "ws_kottke",
      body: "Hallo per Mail",
    });
  });

  it("Nebenwirkungen in fester Reihenfolge: Pause, eigene Nachricht, Entwürfe, Übernahme", async () => {
    const res = await send("Ich schreibe selbst.");
    expect(res.status).toBe(200);
    expect(mocks.updates).toHaveLength(1);
    expect(mocks.updates[0]).toEqual({
      aiPaused: true,
      aiNeedsReply: false,
      updatedAt: expect.any(Date),
    });
    const [eigene] = mocks.letzteEigene.mock.invocationCallOrder;
    const [entwuerfe] = mocks.supersede.mock.invocationCallOrder;
    const [uebernahme] = mocks.setHumanOwned.mock.invocationCallOrder;
    expect(eigene).toBeLessThan(entwuerfe);
    expect(entwuerfe).toBeLessThan(uebernahme);
  });

  it("ohne Deal: keine eigene Nachricht, keine Übernahme, Entwürfe nur am Gespräch", async () => {
    mocks.limit.mockResolvedValue([
      { channelType: "whatsapp", waPhoneNumberId: null, baileysBridgeProvider: "inhouse", dealRecordId: null },
    ]);
    const res = await send("ohne Deal");
    expect(res.status).toBe(200);
    expect(mocks.updates[0]).toMatchObject({ aiPaused: true, aiNeedsReply: false });
    expect(mocks.letzteEigene).not.toHaveBeenCalled();
    expect(mocks.setHumanOwned).not.toHaveBeenCalled();
    expect(mocks.supersede).toHaveBeenCalledWith({
      workspaceId: "ws_kottke",
      conversationId: CONV,
      dealRecordId: null,
      userId: "usr_dario",
      supersededBy: "manual_send",
    });
  });

  it("Fehler der Nebenwirkungen nach dem Senden brechen die Antwort nicht", async () => {
    mocks.letzteEigene.mockRejectedValue(new Error("0054 fehlt"));
    mocks.supersede.mockRejectedValue(new Error("drafts down"));
    mocks.setHumanOwned.mockRejectedValue(new Error("state down"));
    const fehler = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await send("trotzdem raus");
    fehler.mockRestore();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: { id: "msg-1" } });
  });

  it("Anhang: Antwort mit deduped und messages", async () => {
    mocks.documents.mockResolvedValue({
      message: { id: "msg-doc" },
      messages: [{ id: "msg-doc" }, { id: "msg-text" }],
      deduped: false,
      conversationId: CONV,
    });
    const res = await send({ attachments: [{ dealDocumentId: "doc-1" }], idempotencyKey: "k-1" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      data: { id: "msg-doc", deduped: false, messages: [{ id: "msg-doc" }, { id: "msg-text" }] },
    });
    expect(mocks.updates[0]).toMatchObject({ aiPaused: true, aiNeedsReply: false });
    expect(mocks.supersede).toHaveBeenCalledOnce();
  });

  it("Dedup: Pause, Entwürfe und Übernahme wie sonst, nur keine eigene Nachricht", async () => {
    mocks.documents.mockResolvedValue({
      message: { id: "msg-doc", sentAt: new Date("2026-11-01T08:00:00Z") },
      messages: [{ id: "msg-doc" }],
      deduped: true,
      conversationId: CONV,
    });
    const res = await send({ attachments: [{ dealDocumentId: "doc-1" }], idempotencyKey: "k-1" });
    expect(res.status).toBe(200);
    expect((await res.json()).data.deduped).toBe(true);
    expect(mocks.letzteEigene).not.toHaveBeenCalled();
    expect(mocks.updates[0]).toMatchObject({ aiPaused: true, aiNeedsReply: false });
    expect(mocks.supersede).toHaveBeenCalledOnce();
    expect(mocks.setHumanOwned).toHaveBeenCalledWith("ws_kottke", "deal-1", "usr_dario");
  });

  it("OpenClaw: 501 mit dem heutigen Körper, nichts gesendet, keine Nebenwirkungen", async () => {
    kanal({ channelType: "whatsapp", waPhoneNumberId: null, baileysBridgeProvider: "openclaw" });
    const res = await send("Hallo");
    expect(res.status).toBe(501);
    expect(await res.json()).toEqual({
      error: {
        code: "OPENCLAW_OUTBOUND_NOT_IMPLEMENTED",
        message:
          "This WhatsApp number is bridged via OpenClaw, which does not expose outbound to the CRM. Switch this account to the in-house bridge in Integrations to send replies from here.",
      },
    });
    expect(mocks.sendBaileysReply).not.toHaveBeenCalled();
    expect(mocks.sendWhatsAppReply).not.toHaveBeenCalled();
    expect(mocks.sendEmailReply).not.toHaveBeenCalled();
    keineNebenwirkungen();
  });

  it("Gespräch nicht gefunden: 404 mit dem heutigen Körper", async () => {
    mocks.limit.mockResolvedValue([]);
    const res = await send("Hallo");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Conversation not found" });
    expect(mocks.sendBaileysReply).not.toHaveBeenCalled();
    keineNebenwirkungen();
  });

  it("Gespräch nicht gefunden mit Anhang: ebenfalls 404", async () => {
    mocks.limit.mockResolvedValue([]);
    const res = await send({ attachments: [{ dealDocumentId: "doc-1" }] });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Conversation not found" });
    expect(mocks.documents).not.toHaveBeenCalled();
  });

  it("leerer Körper ohne Anhang: 400 body is required", async () => {
    const res = await send("   ");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "body is required" });
    expect(mocks.limit).not.toHaveBeenCalled();
  });

  it("kaputtes JSON: 400 Invalid JSON body", async () => {
    const res = await POST(
      new NextRequest(`https://crm.test/api/v1/inbox/conversations/${CONV}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{nicht json",
      }),
      { params: Promise.resolve({ id: CONV }) }
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Invalid JSON body" });
  });

  it("WA_SESSION_EXPIRED: 409", async () => {
    kanal({ channelType: "whatsapp", waPhoneNumberId: "pn-1", baileysBridgeProvider: null });
    mocks.sendWhatsAppReply.mockRejectedValue(fehler(WhatsAppSessionExpiredError, "24h vorbei"));
    const res = await send("Hallo");
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: { code: "WA_SESSION_EXPIRED", message: "24h vorbei" } });
    keineNebenwirkungen();
  });

  it("BAILEYS_BRIDGE_NOT_CONFIGURED: 503", async () => {
    mocks.sendBaileysReply.mockRejectedValue(fehler(BaileysBridgeNotConfiguredError, "keine Bridge"));
    const res = await send("Hallo");
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({
      error: { code: "BAILEYS_BRIDGE_NOT_CONFIGURED", message: "keine Bridge" },
    });
    keineNebenwirkungen();
  });

  it("BAILEYS_BRIDGE_ERROR: 502 mit Status im Körper", async () => {
    mocks.sendBaileysReply.mockRejectedValue(fehler(BaileysBridgeError, "Bridge 500"));
    const res = await send("Hallo");
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({
      error: { code: "BAILEYS_BRIDGE_ERROR", status: 502, message: "Bridge 500" },
    });
    keineNebenwirkungen();
  });

  it("BAILEYS_MEDIA_TOO_LARGE: 413", async () => {
    mocks.documents.mockRejectedValue(fehler(BaileysMediaTooLargeError, "zu groß"));
    const res = await send({ attachments: [{ dealDocumentId: "doc-1" }] });
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: { code: "BAILEYS_MEDIA_TOO_LARGE", message: "zu groß" } });
    keineNebenwirkungen();
  });

  it("Dokumentfehler aus dem Versand: Status und Text des Fehlers", async () => {
    mocks.documents.mockRejectedValue(new WhatsAppDocumentInputError("Dokument fehlt", 404));
    const res = await send({ attachments: [{ dealDocumentId: "doc-1" }] });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Dokument fehlt" });
    keineNebenwirkungen();
  });

  it("unbekannter Fehler: 500 mit der Fehlermeldung", async () => {
    mocks.sendBaileysReply.mockRejectedValue(new Error("bridge down"));
    const res = await send("Hallo");
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "bridge down" });
    keineNebenwirkungen();
  });

  it("Fehler beim Pausieren des Gesprächs: 500 wie heute", async () => {
    const res = await (async () => {
      mocks.updateFehler = new Error("db down");
      try {
        return await send("Hallo");
      } finally {
        mocks.updateFehler = null;
      }
    })();
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "db down" });
    expect(mocks.supersede).not.toHaveBeenCalled();
  });
});
