import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getAuthContext: vi.fn(),
  limit: vi.fn(),
  sendBaileysMediaReply: vi.fn(),
  sendWhatsAppMediaReply: vi.fn(),
}));

vi.mock("@vercel/blob/client", () => ({
  put: vi.fn(),
  handleUpload: vi.fn(),
}));

vi.mock("@vercel/blob", () => ({
  get: vi.fn(),
  del: vi.fn(),
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
          where: () => ({
            limit: mocks.limit,
          }),
        }),
      }),
    }),
  },
}));

vi.mock("@/services/inbox-whatsapp", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/inbox-whatsapp")>();
  return {
    ...actual,
    sendBaileysMediaReply: mocks.sendBaileysMediaReply,
    sendWhatsAppMediaReply: mocks.sendWhatsAppMediaReply,
  };
});

import { BaileysBridgeError, BaileysMediaTooLargeError } from "@/services/inbox-whatsapp";
import { POST } from "./route";

const CONV = "6e9256ac-a253-4b4e-b49d-0a7845e9f940";

function sendFile() {
  const form = new FormData();
  form.append("file", new File([new Uint8Array([1, 2, 3])], "angebot.pdf", { type: "application/pdf" }));
  return POST(
    new NextRequest(`https://crm.test/api/v1/inbox/conversations/${CONV}/messages/media`, {
      method: "POST",
      body: form,
    }),
    { params: Promise.resolve({ id: CONV }) },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getAuthContext.mockResolvedValue({
    userId: "usr_1",
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
    },
  ]);
});

describe("POST conversation media", () => {
  it("returns the bridge size error as 413", async () => {
    mocks.sendBaileysMediaReply.mockRejectedValue(new BaileysMediaTooLargeError(23 * 1024 * 1024));
    const res = await sendFile();
    expect(res.status).toBe(413);
    const body = await res.json();
    expect(body.error.code).toBe("BAILEYS_MEDIA_TOO_LARGE");
    expect(body.error.message).toContain("WhatsApp-Bridge");
    expect(body.error.message).toContain("30 MB");
  });

  it("returns a bridge 413 as 413 with the clear message", async () => {
    mocks.sendBaileysMediaReply.mockRejectedValue(
      new BaileysBridgeError(
        413,
        "Die Datei ist zu groß für die WhatsApp-Bridge (der JSON-Body überschreitet das Limit).",
      ),
    );
    const res = await sendFile();
    expect(res.status).toBe(413);
    const body = await res.json();
    expect(body.error.code).toBe("BAILEYS_BRIDGE_ERROR");
    expect(body.error.message).toContain("JSON-Body");
  });
});
