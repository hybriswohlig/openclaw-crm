import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getAuthContext: vi.fn(),
  template: vi.fn(),
  vermerk: vi.fn(),
}));

vi.mock("@/lib/api-utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-utils")>();
  return { ...actual, getAuthContext: mocks.getAuthContext };
});

vi.mock("@/services/inbox-whatsapp", () => ({
  sendWhatsAppTemplate: (...args: unknown[]) => mocks.template(...args),
}));

vi.mock("@/services/inbox-senden", () => ({
  vermerkeEigeneNachricht: (...args: unknown[]) => mocks.vermerk(...args),
}));

import { POST } from "./route";

const EINGABE = {
  channelAccountId: "ch-waba",
  toPhone: "+491701234567",
  customerName: "Anna",
  templateName: "termin",
  languageCode: "de",
  bodyParams: ["Anna"],
  dealRecordId: "deal-9",
};

function send(body: Record<string, unknown>) {
  return POST(
    new NextRequest("https://crm.test/api/v1/inbox/whatsapp/send-template", {
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
  mocks.vermerk.mockResolvedValue(undefined);
});

describe("POST send-template", () => {
  it("vermerkt die eigene Nachricht am Gespräch mit der Sendezeit", async () => {
    const gesendet = new Date("2026-11-05T13:00:00Z");
    mocks.template.mockResolvedValue({
      message: { id: "m-tpl", sentAt: gesendet },
      conversationId: "conv-tpl",
      createdNewConversation: true,
    });
    const res = await send(EINGABE);
    expect(res.status).toBe(200);
    expect((await res.json()).data.conversationId).toBe("conv-tpl");
    expect(mocks.template).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: "ws_kottke", dealRecordId: "deal-9" })
    );
    expect(mocks.vermerk).toHaveBeenCalledWith({
      workspaceId: "ws_kottke",
      conversationId: "conv-tpl",
      sentAt: gesendet,
    });
  });

  it("kein Vermerk, wenn Meta ablehnt", async () => {
    mocks.template.mockRejectedValue(new Error("WhatsApp template send failed: Meta 400"));
    const res = await send(EINGABE);
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "WhatsApp template send failed: Meta 400" });
    expect(mocks.vermerk).not.toHaveBeenCalled();
  });

  it("Pflichtfelder fehlen: 400, nichts gesendet", async () => {
    const res = await send({ channelAccountId: "ch-waba" });
    expect(res.status).toBe(400);
    expect(mocks.template).not.toHaveBeenCalled();
    expect(mocks.vermerk).not.toHaveBeenCalled();
  });
});
