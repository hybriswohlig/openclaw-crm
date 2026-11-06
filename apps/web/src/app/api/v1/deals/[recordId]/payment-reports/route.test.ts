import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getAuthContext: vi.fn(),
  dealImWorkspace: vi.fn(),
  ladeZahlungsmeldungen: vi.fn(),
}));

// Kein Zugriff auf die Datenbank: jeder Zugriff auf `db` lässt den Test scheitern.
vi.mock("@/db", () => ({
  db: new Proxy({}, { get(_t, p) { if (p === "then" || typeof p === "symbol") return undefined; throw new Error(`@/db im Test (${String(p)})`); } }),
}));
vi.mock("@/lib/api-utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-utils")>();
  return { ...actual, getAuthContext: mocks.getAuthContext };
});
vi.mock("@/lib/kalkulation-versionen-antwort", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/kalkulation-versionen-antwort")>();
  return { ...actual, dealImWorkspace: mocks.dealImWorkspace };
});
vi.mock("@/services/zahlungsmeldungen", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/zahlungsmeldungen")>();
  return { ...actual, ladeZahlungsmeldungen: mocks.ladeZahlungsmeldungen };
});

import { GET } from "./route";

const CTX = { userId: "usr_1", workspaceId: "ws_1", workspaceRole: "admin" as const, authMethod: "cookie" as const };
const get = () => new NextRequest("http://localhost/api/v1/deals/deal_1/payment-reports");
const p = () => ({ params: Promise.resolve({ recordId: "deal_1" }) });
const MELDUNG = { eventId: "e1", gemeldetAm: "2026-11-05T09:00:00.000Z", betragCent: 52000, zahlungsart: "paypal", variante: "final" };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getAuthContext.mockResolvedValue(CTX);
  mocks.dealImWorkspace.mockResolvedValue(true);
  mocks.ladeZahlungsmeldungen.mockResolvedValue([MELDUNG]);
});

describe("GET /deals/[recordId]/payment-reports", () => {
  it("ohne Anmeldung 401", async () => {
    mocks.getAuthContext.mockResolvedValue(null);
    expect((await GET(get(), p())).status).toBe(401);
    expect(mocks.ladeZahlungsmeldungen).not.toHaveBeenCalled();
  });

  it("Deal aus fremdem Workspace → 404, nichts gelesen", async () => {
    mocks.dealImWorkspace.mockResolvedValue(false);
    const res = await GET(get(), p());
    expect(res.status).toBe(404);
    expect(mocks.dealImWorkspace).toHaveBeenCalledWith("ws_1", "deal_1");
    expect(mocks.ladeZahlungsmeldungen).not.toHaveBeenCalled();
  });

  it("liefert { meldungen } des Deals", async () => {
    const res = await GET(get(), p());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: { meldungen: [MELDUNG] } });
    expect(mocks.ladeZahlungsmeldungen).toHaveBeenCalledWith("ws_1", "deal_1");
  });

  it("Nur-Lesen-Schlüssel darf lesen", async () => {
    mocks.getAuthContext.mockResolvedValue({ ...CTX, authMethod: "api_key", apiKeyAccess: "read" });
    expect((await GET(get(), p())).status).toBe(200);
  });
});
