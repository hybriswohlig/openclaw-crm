import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// Meta stellt einen Webhook nur erneut zu, wenn wir nicht mit 2xx antworten.
// Scheitert das Speichern einer Nachricht, muss die Antwort das zeigen, sonst
// ist die Kundennachricht verloren.
const mocks = vi.hoisted(() => ({
  handleWebhookPayload: vi.fn(),
}));

vi.mock("@/services/inbox-whatsapp", () => ({
  handleWebhookPayload: mocks.handleWebhookPayload,
  verifyWebhookSignature: () => true,
  getAppSecret: async () => "secret",
  getVerifyToken: async () => "verify",
}));
vi.mock("@/services/workspace", () => ({ getSingletonWorkspaceId: async () => "ws_1" }));

import { POST } from "./route";

function webhook() {
  return POST(
    new NextRequest("https://crm.test/api/webhooks/whatsapp", {
      method: "POST",
      headers: { "x-hub-signature-256": "sha256=x" },
      body: JSON.stringify({ object: "whatsapp_business_account", entry: [] }),
    })
  );
}

describe("POST /api/webhooks/whatsapp", () => {
  beforeEach(() => vi.clearAllMocks());

  it("bestätigt mit 200, wenn alles gespeichert ist", async () => {
    mocks.handleWebhookPayload.mockResolvedValue(undefined);
    expect((await webhook()).status).toBe(200);
  });

  it("antwortet 500, wenn eine Nachricht nicht gespeichert wurde, damit Meta neu zustellt", async () => {
    mocks.handleWebhookPayload.mockRejectedValue(new Error("db down"));
    expect((await webhook()).status).toBe(500);
  });
});
