import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getAuthContext: vi.fn(),
  ladeNavZaehler: vi.fn(),
}));

vi.mock("@/db", () => ({
  db: new Proxy({}, { get(_t, p) { if (p === "then" || typeof p === "symbol") return undefined; throw new Error(`@/db im Test (${String(p)})`); } }),
}));
vi.mock("@/lib/api-utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-utils")>();
  return { ...actual, getAuthContext: mocks.getAuthContext };
});
vi.mock("@/services/heute", () => ({ ladeNavZaehler: mocks.ladeNavZaehler }));

import { GET } from "./route";

const CTX = { userId: "usr_1", workspaceId: "ws_1", workspaceRole: "admin" as const, authMethod: "api_key" as const };
const get = () => new NextRequest("http://localhost/api/v1/heute/zaehler");

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getAuthContext.mockResolvedValue(CTX);
  mocks.ladeNavZaehler.mockResolvedValue({ heute: 4, leads: 19, kasse: 0 });
});

describe("GET /heute/zaehler", () => {
  it("ohne Anmeldung 401", async () => {
    mocks.getAuthContext.mockResolvedValue(null);
    expect((await GET(get())).status).toBe(401);
    expect(mocks.ladeNavZaehler).not.toHaveBeenCalled();
  });

  it("liefert { data: NavZaehler }", async () => {
    const res = await GET(get());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: { heute: 4, leads: 19, kasse: 0 } });
    expect(mocks.ladeNavZaehler).toHaveBeenCalledWith("ws_1");
  });
});
