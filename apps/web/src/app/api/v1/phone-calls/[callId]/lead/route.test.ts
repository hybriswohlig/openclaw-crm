import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getAuthContext: vi.fn(),
  leadAusAnruf: vi.fn(),
}));

vi.mock("@/db", () => ({
  db: new Proxy({}, { get(_t, p) { if (p === "then" || typeof p === "symbol") return undefined; throw new Error(`@/db im Test (${String(p)})`); } }),
}));
vi.mock("@/lib/api-utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-utils")>();
  return { ...actual, getAuthContext: mocks.getAuthContext };
});
vi.mock("@/services/phone-call-lead", () => ({ leadAusAnruf: mocks.leadAusAnruf }));

import { POST } from "./route";

const CTX = { userId: "usr_1", workspaceId: "ws_1", workspaceRole: "admin" as const, authMethod: "cookie" as const };
const params = Promise.resolve({ callId: "call_1" });
const ANGELEGT = {
  art: "angelegt" as const,
  dealRecordId: "deal_1",
  personRecordId: "person_1",
  matchStatus: "matched" as const,
  leadNeu: true,
};

const post = (body: unknown) =>
  new NextRequest("http://localhost/api/v1/phone-calls/call_1/lead", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getAuthContext.mockResolvedValue(CTX);
  mocks.leadAusAnruf.mockResolvedValue(ANGELEGT);
});

describe("POST /phone-calls/[callId]/lead", () => {
  it("gibt personId beschnitten an den Dienst weiter", async () => {
    const res = await POST(post({ name: "Ada Lovelace", personId: "  person_1  " }), { params });
    expect(res.status).toBe(200);
    expect(mocks.leadAusAnruf).toHaveBeenCalledWith({
      workspaceId: "ws_1",
      callId: "call_1",
      name: "Ada Lovelace",
      wahl: null,
      personId: "person_1",
      actorId: "usr_1",
    });
  });

  it("personId mit API-Schlüssel 403, ohne personId bleibt der Schlüssel erlaubt (Review I1)", async () => {
    mocks.getAuthContext.mockResolvedValue({ ...CTX, authMethod: "api_key", apiKeyAccess: "write" });
    const verboten = await POST(post({ personId: "person_1" }), { params });
    expect(verboten.status).toBe(403);
    expect(mocks.leadAusAnruf).not.toHaveBeenCalled();

    const erlaubt = await POST(post({ name: "Ada Lovelace" }), { params });
    expect(erlaubt.status).toBe(200);
    expect(mocks.leadAusAnruf).toHaveBeenCalledWith(expect.objectContaining({ personId: null }));
  });

  it("personId muss Text sein", async () => {
    const res = await POST(post({ personId: 12 }), { params });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: { code: "BAD_REQUEST", message: "Person muss eine Kennung sein" } });
    expect(mocks.leadAusAnruf).not.toHaveBeenCalled();
  });

  it("unbekannter Anruf 404", async () => {
    mocks.leadAusAnruf.mockResolvedValue({ art: "fehlt" });
    const res = await POST(post({ name: "Ada Lovelace" }), { params });
    expect(res.status).toBe(404);
    expect(mocks.leadAusAnruf).toHaveBeenCalledWith(expect.objectContaining({ callId: "call_1", personId: null }));
  });
});
