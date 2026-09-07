import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const send = vi.hoisted(() => vi.fn());
vi.mock("@/services/customer-portal-data", () => ({ emailPortalDocument: send }));
import { POST } from "./route";
const params = { params: Promise.resolve({ token: "test-token", id: "document-id" }) };
beforeEach(() => { send.mockReset(); send.mockResolvedValue({ ok: true }); });
it("delegates only the scoped identifiers; ignores client recipient input", async () => {
  const req = new NextRequest("https://portal.example.invalid/api/public/test-token/documents/document-id/email", { method: "POST", headers: { origin: "https://portal.example.invalid", "content-type": "application/json" }, body: JSON.stringify({ to: "attacker@example.invalid" }) });
  expect((await POST(req, params)).status).toBe(200);
  expect(send).toHaveBeenCalledWith("test-token", "document-id");
});
it("rejects cross-origin submissions before sending", async () => {
  expect((await POST(new NextRequest("https://portal.example.invalid/api", { method: "POST", headers: { origin: "https://other.example.invalid" } }), params)).status).toBe(403);
  expect(send).not.toHaveBeenCalled();
});
it("rejects malformed identifiers", async () => {
  expect((await POST(new NextRequest("https://portal.example.invalid/api", { method: "POST" }), { params: Promise.resolve({ token: "test-token", id: "../secret" }) })).status).toBe(400);
  expect(send).not.toHaveBeenCalled();
});
it("returns a rate-limit status and hides unexpected transport errors", async () => {
  const req = new NextRequest("https://portal.example.invalid/api", { method: "POST" });
  send.mockResolvedValue({ ok: false, reason: "rate_limited" });
  expect((await POST(req, params)).status).toBe(429);
  send.mockRejectedValue(new Error("secret transport info"));
  const response = await POST(req, params);
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ error: { code: "SEND_FAILED" } });
});
