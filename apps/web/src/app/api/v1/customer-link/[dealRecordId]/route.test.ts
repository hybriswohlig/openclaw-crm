import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// Ein weitergegebener Link wird ersetzt statt nur gesperrt: Der alte Token ist
// tot, der Kunde bekommt einen neuen und behält seinen Widerrufsbutton.
const mocks = vi.hoisted(() => ({
  getAuthContext: vi.fn(),
  reactivate: vi.fn(),
  erneuere: vi.fn(),
  portalAn: vi.fn(),
}));

vi.mock("@/lib/api-utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-utils")>();
  return { ...actual, getAuthContext: mocks.getAuthContext };
});
vi.mock("@/db", () => ({
  db: { select: () => ({ from: () => ({ where: () => ({ limit: async () => [{ dealNumber: "2026-042" }] }) }) }) },
}));
vi.mock("@/services/customer-portal-data", () => ({
  ensureCustomerStatusLink: vi.fn(),
  loadVisitTelemetry: vi.fn(),
  reactivateCustomerStatusLink: mocks.reactivate,
  erneuereCustomerStatusLink: mocks.erneuere,
  portalAnFuerDeal: mocks.portalAn,
  resolveCustomerLinkOrigin: async () => "https://status.test",
  revokeCustomerStatusLink: vi.fn(),
}));
vi.mock("@/services/kva-widerruf", () => ({ laufendeWiderrufsfrist: async () => null }));
vi.mock("@/lib/kalkulation-versionen-antwort", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/kalkulation-versionen-antwort")>()),
  dealImWorkspace: async () => true,
}));

import { GET, PATCH } from "./route";

function patch(body?: unknown) {
  return PATCH(
    new NextRequest("https://crm.test/api/v1/customer-link/deal_1", {
      method: "PATCH",
      ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { "content-type": "application/json" } }),
    }),
    { params: Promise.resolve({ dealRecordId: "deal_1" }) }
  );
}

describe("PATCH /api/v1/customer-link/[dealRecordId]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAuthContext.mockResolvedValue({ userId: "usr_1", workspaceId: "ws_1", workspaceRole: "admin", permissions: {}, authMethod: "session" });
    mocks.reactivate.mockResolvedValue({ token: "alt", dealRecordId: "deal_1" });
    mocks.erneuere.mockResolvedValue({ token: "neu", dealRecordId: "deal_1" });
  });

  it("ohne Angabe: den alten Link wieder freigeben", async () => {
    const res = await patch();
    const json = await res.json();
    expect(mocks.reactivate).toHaveBeenCalledWith({ workspaceId: "ws_1", dealRecordId: "deal_1" });
    expect(mocks.erneuere).not.toHaveBeenCalled();
    expect(json.data.url).toBe("https://status.test/s/alt");
  });

  it("neu: true erstellt einen neuen Link", async () => {
    const res = await patch({ neu: true });
    const json = await res.json();
    expect(mocks.erneuere).toHaveBeenCalledWith({ workspaceId: "ws_1", dealRecordId: "deal_1" });
    expect(mocks.reactivate).not.toHaveBeenCalled();
    expect(json.data.url).toBe("https://status.test/s/neu");
    expect(json.data.erneuert).toBe(true);
  });
});

describe("GET /api/v1/customer-link/[dealRecordId]: Portal der Firma (Review kv-danach M1)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAuthContext.mockResolvedValue({ userId: "usr_1", workspaceId: "ws_1", workspaceRole: "admin", permissions: {}, authMethod: "session" });
  });

  it.each([true, false])("meldet portalAn = %s aus den Einstellungen der Firma", async (an) => {
    mocks.portalAn.mockResolvedValue(an);
    const res = await GET(new NextRequest("https://crm.test/api/v1/customer-link/deal_1"), {
      params: Promise.resolve({ dealRecordId: "deal_1" }),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).data.portalAn).toBe(an);
    expect(mocks.portalAn).toHaveBeenCalledWith("ws_1", "deal_1");
  });

  it("Ladefehler beim Portal-Schalter: trotzdem 200 mit Link, portalAn true (Review M6)", async () => {
    mocks.portalAn.mockRejectedValue(new Error("Branding weg"));
    const fehler = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const res = await GET(new NextRequest("https://crm.test/api/v1/customer-link/deal_1"), {
      params: Promise.resolve({ dealRecordId: "deal_1" }),
    });
    expect(res.status).toBe(200);
    const data = (await res.json()).data;
    expect(data.portalAn).toBe(true);
    expect(data.url).toContain("https://status.test/s/");
    expect(fehler).toHaveBeenCalled();
    fehler.mockRestore();
  });
});
