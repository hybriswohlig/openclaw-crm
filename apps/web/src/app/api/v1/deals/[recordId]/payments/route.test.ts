import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { ZAHLUNGSART_FEHLER } from "@/lib/zahlungsart";

const mocks = vi.hoisted(() => ({
  getAuthContext: vi.fn(),
  createPayment: vi.fn(),
  resolveDealOperatingCompany: vi.fn(),
  listPayments: vi.fn(),
  maybeNotifyDepositReceived: vi.fn(),
  nachZahlung: vi.fn(),
  dealImWorkspace: vi.fn(),
  erinnerungenStoppen: vi.fn(),
}));

vi.mock("@/lib/kalkulation-versionen-antwort", async (orig) => ({
  ...(await orig<typeof import("@/lib/kalkulation-versionen-antwort")>()),
  dealImWorkspace: mocks.dealImWorkspace,
}));
vi.mock("@/services/rechnungen", () => ({ erinnerungenStoppen: mocks.erinnerungenStoppen }));

vi.mock("@/lib/api-utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-utils")>();
  return { ...actual, getAuthContext: mocks.getAuthContext };
});

vi.mock("@/services/financial", () => ({
  listPayments: mocks.listPayments,
  createPayment: mocks.createPayment,
  resolveDealOperatingCompany: mocks.resolveDealOperatingCompany,
}));

vi.mock("@/services/customer-portal-notifications", () => ({
  maybeNotifyDepositReceived: mocks.maybeNotifyDepositReceived,
}));

vi.mock("@/services/nach-zahlung", () => ({
  nachZahlung: mocks.nachZahlung,
}));

import { GET, POST } from "./route";

const WORKSPACE_ID = "ws-1";
const DEAL_ID = "deal-1";
const AUTH = {
  userId: "usr-1",
  workspaceId: WORKSPACE_ID,
  workspaceRole: "admin" as const,
  permissions: {},
  authMethod: "cookie" as const,
};

function post(body: Record<string, unknown>) {
  return POST(
    new NextRequest(`https://crm.test/api/v1/deals/${DEAL_ID}/payments`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ recordId: DEAL_ID }) },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getAuthContext.mockResolvedValue(AUTH);
  mocks.resolveDealOperatingCompany.mockResolvedValue("oc-1");
  mocks.createPayment.mockResolvedValue({ id: "pay-1", paymentMethod: "bank_transfer" });
  mocks.maybeNotifyDepositReceived.mockResolvedValue(undefined);
  mocks.nachZahlung.mockResolvedValue({ stufeGesetzt: false });
  mocks.dealImWorkspace.mockResolvedValue(true);
  mocks.erinnerungenStoppen.mockResolvedValue(0);
});

describe("POST /api/v1/deals/[recordId]/payments", () => {
  it("speichert „ueberweisung“ als bank_transfer und setzt danach die Stufe", async () => {
    const res = await post({ date: "2026-11-06", amount: "500.00", paymentMethod: "ueberweisung" });

    expect(res.status).toBe(201);
    expect(mocks.createPayment).toHaveBeenCalledWith(
      WORKSPACE_ID,
      DEAL_ID,
      expect.objectContaining({ paymentMethod: "bank_transfer", amount: "500.00", date: "2026-11-06", quelle: "hand", createdBy: "usr-1" }),
    );
    expect(mocks.nachZahlung).toHaveBeenCalledWith(WORKSPACE_ID, DEAL_ID, "usr-1");
    expect(mocks.erinnerungenStoppen).toHaveBeenCalledWith(WORKSPACE_ID, DEAL_ID, "zahlung");
  });

  it("lehnt „Scheck“ ab und speichert nichts", async () => {
    const res = await post({ date: "2026-11-06", amount: "500.00", paymentMethod: "Scheck" });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error.message).toBe(ZAHLUNGSART_FEHLER);
    expect(mocks.createPayment).not.toHaveBeenCalled();
    expect(mocks.nachZahlung).not.toHaveBeenCalled();
  });

  it("liefert die Zahlung auch, wenn das Setzen der Stufe scheitert", async () => {
    mocks.nachZahlung.mockRejectedValue(new Error("stufe"));
    const fehler = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await post({ date: "2026-11-06", amount: "10", paymentMethod: "bar" });

    expect(res.status).toBe(201);
    expect(mocks.createPayment).toHaveBeenCalledWith(
      WORKSPACE_ID,
      DEAL_ID,
      expect.objectContaining({ paymentMethod: "cash" }),
    );
    fehler.mockRestore();
  });
});

describe("Zahlungsrouten: Workspace und Rechte (Plan 9, Entscheidung 9)", () => {
  it("fremder Deal: GET und POST 404, nichts gelesen oder geschrieben", async () => {
    mocks.dealImWorkspace.mockResolvedValue(false);
    const get = await GET(new NextRequest(`https://crm.test/api/v1/deals/${DEAL_ID}/payments`), {
      params: Promise.resolve({ recordId: DEAL_ID }),
    });
    expect(get.status).toBe(404);
    expect(mocks.listPayments).not.toHaveBeenCalled();
    expect((await post({ date: "2026-11-06", amount: "5" })).status).toBe(404);
    expect(mocks.createPayment).not.toHaveBeenCalled();
  });

  it("GET filtert fremde Workspaces heraus", async () => {
    mocks.listPayments.mockResolvedValue([
      { id: "a", workspaceId: WORKSPACE_ID },
      { id: "b", workspaceId: "ws-fremd" },
    ]);
    const res = await GET(new NextRequest(`https://crm.test/api/v1/deals/${DEAL_ID}/payments`), {
      params: Promise.resolve({ recordId: DEAL_ID }),
    });
    expect((await res.json()).data.map((z: { id: string }) => z.id)).toEqual(["a"]);
  });

  it("Nur-Lese-Schlüssel und Agent dürfen nicht erfassen (403)", async () => {
    mocks.getAuthContext.mockResolvedValue({ ...AUTH, authMethod: "api_key", apiKeyAccess: "read" });
    expect((await post({ date: "2026-11-06", amount: "5" })).status).toBe(403);
    mocks.getAuthContext.mockResolvedValue({ ...AUTH, authMethod: "api_key", apiKeyAccess: "full" });
    expect((await post({ date: "2026-11-06", amount: "5" })).status).toBe(403);
    expect(mocks.createPayment).not.toHaveBeenCalled();
  });
});
