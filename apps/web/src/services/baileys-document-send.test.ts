import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  docRows: [] as unknown[],
  mediaReply: vi.fn(),
  textReply: vi.fn(),
  bootstrap: vi.fn(),
  createDeal: vi.fn(),
  vermerk: vi.fn(),
}));

vi.mock("@/db", async () => {
  const { dealDocuments } = await import("@/db/schema/financial");
  const select = () => ({
    from: (table: unknown) => ({
      where: () => {
        const rows = table === dealDocuments ? m.docRows : [];
        return {
          limit: async () => rows,
          orderBy: () => ({ limit: async () => [] }),
        };
      },
    }),
  });
  return {
    db: {
      select,
      execute: vi.fn(async () => []),
      delete: () => ({ where: async () => undefined }),
    },
  };
});
vi.mock("@/services/inbox-whatsapp", () => ({
  sendBaileysMediaReply: m.mediaReply,
  sendBaileysReply: m.textReply,
  bootstrapBaileysConversation: m.bootstrap,
}));
vi.mock("@/services/inbox", () => ({ createDealForNewConversation: m.createDeal }));
vi.mock("@/services/versand-vermerk", () => ({ vermerkeVersand: m.vermerk }));

import { sendBaileysOpeningDocuments, sendConversationDocuments } from "./baileys-document-send";

const pdf = Buffer.from("%PDF-1.7\nkv").toString("base64");
const kvDokument = { fileName: "KV-1001.pdf", mimeType: "application/pdf", fileSize: 12, fileContent: pdf, documentType: "quotation" };

beforeEach(() => {
  vi.resetAllMocks();
  m.docRows = [kvDokument];
  m.mediaReply.mockResolvedValue({ id: "msg1" });
  m.textReply.mockResolvedValue({ id: "msg2" });
  m.bootstrap.mockResolvedValue({ conv: { id: "conv1", dealRecordId: "deal1" }, createdNewConversation: false, waId: "49", contactId: "c1" });
  m.vermerk.mockResolvedValue(undefined);
});

const gespraech = {
  conversationId: "conv1",
  workspaceId: "ws1",
  dealRecordId: "deal1",
  body: "Ihr KV",
  attachments: [{ kind: "dealDocument" as const, dealDocumentId: "doc1" }],
};

describe("Versand-Vermerk beim WhatsApp-Versand", () => {
  it("vermerkt den KV nach erfolgreichem Senden im Gespräch", async () => {
    await sendConversationDocuments(gespraech);
    expect(m.vermerk).toHaveBeenCalledWith("doc1", "whatsapp");
    expect(m.mediaReply.mock.invocationCallOrder[0]).toBeLessThan(m.vermerk.mock.invocationCallOrder[0]);
  });

  it("vermerkt den KV beim Erstversand an eine neue Nummer", async () => {
    await sendBaileysOpeningDocuments({
      workspaceId: "ws1",
      channelAccountId: "acc1",
      toPhone: "+49170",
      customerName: "Test",
      dealRecordId: "deal1",
      body: "",
      attachments: [{ kind: "dealDocument", dealDocumentId: "doc1" }],
    });
    expect(m.vermerk).toHaveBeenCalledWith("doc1", "whatsapp");
  });

  it("vermerkt nichts, wenn das Senden scheitert", async () => {
    m.mediaReply.mockRejectedValue(new Error("bridge offline"));
    await expect(sendConversationDocuments(gespraech)).rejects.toThrow("bridge offline");
    expect(m.vermerk).not.toHaveBeenCalled();
  });

  it("vermerkt nur Dokumente vom Typ quotation", async () => {
    m.docRows = [{ ...kvDokument, documentType: "invoice" }];
    await sendConversationDocuments(gespraech);
    expect(m.mediaReply).toHaveBeenCalledTimes(1);
    expect(m.vermerk).not.toHaveBeenCalled();
  });

  it("vermerkt keine Inline-Anhänge", async () => {
    await sendConversationDocuments({
      ...gespraech,
      attachments: [{ kind: "inline", filename: "KV.pdf", contentType: "application/pdf", dataBase64: pdf }],
    });
    expect(m.mediaReply).toHaveBeenCalledTimes(1);
    expect(m.vermerk).not.toHaveBeenCalled();
  });

  it("ein Fehler beim Vermerk lässt den Versand erfolgreich", async () => {
    m.vermerk.mockRejectedValue(new Error("db down"));
    const out = await sendConversationDocuments(gespraech);
    expect(out.deduped).toBe(false);
    expect(out.message).toEqual({ id: "msg1" });
  });
});
