import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getAuthContext: vi.fn(),
  ladeHeute: vi.fn(),
}));

vi.mock("@/db", () => ({
  db: new Proxy({}, { get(_t, p) { if (p === "then" || typeof p === "symbol") return undefined; throw new Error(`@/db im Test (${String(p)})`); } }),
}));
vi.mock("@/lib/api-utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-utils")>();
  return { ...actual, getAuthContext: mocks.getAuthContext };
});
vi.mock("@/services/heute", () => ({ ladeHeute: mocks.ladeHeute }));

import { GET } from "./route";

const CTX = { userId: "usr_1", workspaceId: "ws_1", workspaceRole: "admin" as const, authMethod: "api_key" as const };
const get = () => new NextRequest("http://localhost/api/v1/heute");
const ANTWORT = {
  tag: "2026-11-06",
  chips: { warten: 2, kv_ungesehen: 0, ohne_team: 1, rechnung_offen: 0, ohne_ab: 0, diese_woche: 3 },
  inbox: { ungelesen: 1, wartenAufUns: 2, kiEntwuerfe: 0, infoKeinLead: 4 },
  inboxAbgeschnitten: false,
  heute: [],
  morgen: [],
  naechster: null,
  meldungen: [],
  meldungenGesamt: 0,
  freigaben: [],
  tagesabschluss: [],
  stand: "2026-11-06T11:00:00.000Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getAuthContext.mockResolvedValue(CTX);
  mocks.ladeHeute.mockResolvedValue(ANTWORT);
});

describe("GET /heute", () => {
  it("ohne Anmeldung 401", async () => {
    mocks.getAuthContext.mockResolvedValue(null);
    expect((await GET(get())).status).toBe(401);
    expect(mocks.ladeHeute).not.toHaveBeenCalled();
  });

  it("liefert { data: HeuteAntwort } für den Workspace", async () => {
    const res = await GET(get());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: ANTWORT });
    expect(mocks.ladeHeute).toHaveBeenCalledWith("ws_1");
  });
});
