import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getAuthContext: vi.fn(),
  getPhoneCall: vi.fn(),
  batchGetRecordDisplayNames: vi.fn(),
}));

// Kein Zugriff auf die Datenbank: jeder Zugriff auf `db` lässt den Test scheitern.
vi.mock("@/db", () => ({
  db: new Proxy({}, { get(_t, p) { if (p === "then" || typeof p === "symbol") return undefined; throw new Error(`@/db im Test (${String(p)})`); } }),
}));
vi.mock("@/lib/api-utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-utils")>();
  return { ...actual, getAuthContext: mocks.getAuthContext };
});
vi.mock("@/services/phone-calls", () => ({ getPhoneCall: mocks.getPhoneCall }));
vi.mock("@/services/display-names", () => ({ batchGetRecordDisplayNames: mocks.batchGetRecordDisplayNames }));

import { GET } from "./route";

const CTX = { userId: "usr_1", workspaceId: "ws_1", workspaceRole: "admin" as const, authMethod: "cookie" as const };
const params = Promise.resolve({ callId: "call_1" });
const get = () => new NextRequest("http://localhost/api/v1/phone-calls/call_1");

const ZEILE = {
  id: "call_1",
  workspaceId: "ws_1",
  externalId: "ext_1",
  callerRaw: "01550 0000201",
  callerE164: "+4915500000201",
  calledRaw: "0711 1234",
  calledE164: "+497111234",
  lineLabel: "Festnetz",
  answeredBy: "Dario",
  startedAt: new Date("2026-11-05T09:14:00.000Z"),
  durationSeconds: 240,
  transcript: "Kunde: Guten Tag.\nMitarbeiter: Hallo.",
  summary: "Umzug im Dezember",
  keywords: ["Umzug", "Dezember"],
  personRecordId: "person_1",
  dealRecordId: "deal_1",
  matchStatus: "matched",
  createdAt: new Date("2026-11-05T09:20:00.000Z"),
  updatedAt: new Date("2026-11-05T09:20:00.000Z"),
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getAuthContext.mockResolvedValue(CTX);
  mocks.getPhoneCall.mockResolvedValue(ZEILE);
  mocks.batchGetRecordDisplayNames.mockResolvedValue(new Map([["person_1", { displayName: "Familie Weber" }]]));
});

describe("GET /phone-calls/[callId]", () => {
  it("ohne Anmeldung 401, nichts gelesen", async () => {
    mocks.getAuthContext.mockResolvedValue(null);
    expect((await GET(get(), { params })).status).toBe(401);
    expect(mocks.getPhoneCall).not.toHaveBeenCalled();
    expect(mocks.batchGetRecordDisplayNames).not.toHaveBeenCalled();
  });

  it("Anruf aus fremdem Workspace → 404 (die Abfrage filtert auf den Workspace)", async () => {
    mocks.getPhoneCall.mockResolvedValue(null);
    const res = await GET(get(), { params });
    expect(res.status).toBe(404);
    expect(mocks.getPhoneCall).toHaveBeenCalledWith("ws_1", "call_1");
    expect(mocks.batchGetRecordDisplayNames).not.toHaveBeenCalled();
  });

  it("liefert den Anruf mit Transkript und Personenname in den Feldnamen der Liste", async () => {
    const res = await GET(get(), { params });
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({
      id: "call_1",
      callerE164: "+4915500000201",
      callerRaw: "01550 0000201",
      calledE164: "+497111234",
      lineLabel: "Festnetz",
      answeredBy: "Dario",
      startedAt: "2026-11-05T09:14:00.000Z",
      durationSeconds: 240,
      summary: "Umzug im Dezember",
      transcript: "Kunde: Guten Tag.\nMitarbeiter: Hallo.",
      keywords: ["Umzug", "Dezember"],
      personRecordId: "person_1",
      personName: "Familie Weber",
      dealRecordId: "deal_1",
      matchStatus: "matched",
    });
    expect(mocks.batchGetRecordDisplayNames).toHaveBeenCalledWith(["person_1"]);
  });

  it("Stichworte fehlen → leere Liste; ohne Person kein Name und keine Namensabfrage", async () => {
    mocks.getPhoneCall.mockResolvedValue({ ...ZEILE, keywords: null, personRecordId: null });
    const res = await GET(get(), { params });
    const data = (await res.json()).data;
    expect(data.keywords).toEqual([]);
    expect(data.personName).toBeNull();
    expect(mocks.batchGetRecordDisplayNames).not.toHaveBeenCalled();
  });
});
