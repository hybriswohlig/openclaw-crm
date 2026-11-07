import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getAuthContext: vi.fn(),
  ladeFirmenEinstellungen: vi.fn(),
  speichereFirmenEinstellungen: vi.fn(),
}));

vi.mock("@/lib/api-utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-utils")>();
  return { ...actual, getAuthContext: mocks.getAuthContext };
});
vi.mock("@/services/company-settings", () => ({
  ladeFirmenEinstellungen: mocks.ladeFirmenEinstellungen,
  speichereFirmenEinstellungen: mocks.speichereFirmenEinstellungen,
}));

import { GET, PUT } from "./route";

const ADMIN = { userId: "usr_1", workspaceId: "ws_1", workspaceRole: "admin" as const };
const MEMBER = { userId: "usr_2", workspaceId: "ws_1", workspaceRole: "member" as const };
const params = Promise.resolve({ ocId: "oc_1" });

function req(method: "GET" | "PUT", body?: unknown) {
  return new NextRequest("http://localhost/api/v1/company-settings/oc_1", {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: body === undefined ? undefined : { "content-type": "application/json" },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getAuthContext.mockResolvedValue(ADMIN);
  mocks.ladeFirmenEinstellungen.mockResolvedValue({ zeitposten: [], rechnerMarke: null });
  mocks.speichereFirmenEinstellungen.mockResolvedValue(undefined);
});

describe("GET/PUT /company-settings/[ocId]", () => {
  it("ohne Anmeldung 401", async () => {
    mocks.getAuthContext.mockResolvedValue(null);
    expect((await GET(req("GET"), { params })).status).toBe(401);
    expect((await PUT(req("PUT", {}), { params })).status).toBe(401);
    expect(mocks.ladeFirmenEinstellungen).not.toHaveBeenCalled();
    expect(mocks.speichereFirmenEinstellungen).not.toHaveBeenCalled();
  });

  it("PUT als member → 403", async () => {
    mocks.getAuthContext.mockResolvedValue(MEMBER);
    const res = await PUT(req("PUT", { rechnerMarke: "kottke" }), { params });
    expect(res.status).toBe(403);
    expect(mocks.speichereFirmenEinstellungen).not.toHaveBeenCalled();
  });

  it("GET als member ist erlaubt", async () => {
    mocks.getAuthContext.mockResolvedValue(MEMBER);
    const res = await GET(req("GET"), { params });
    expect(res.status).toBe(200);
    expect(mocks.ladeFirmenEinstellungen).toHaveBeenCalledWith("ws_1", "oc_1");
  });

  it("PUT mit rechnerMarke ikea → 400", async () => {
    const res = await PUT(req("PUT", { rechnerMarke: "ikea" }), { params });
    expect(res.status).toBe(400);
    expect(mocks.speichereFirmenEinstellungen).not.toHaveBeenCalled();
  });

  it("PUT mit ungültigen Zeitposten → 400", async () => {
    const res = await PUT(
      req("PUT", { zeitposten: [{ id: "klavier", bezeichnung: "Klavier", minuten: 0 }] }),
      { params }
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error.message).toMatch(/Minuten/);
    expect(mocks.speichereFirmenEinstellungen).not.toHaveBeenCalled();
  });

  it("PUT fremde Firma → 404", async () => {
    mocks.speichereFirmenEinstellungen.mockResolvedValue(null);
    const res = await PUT(req("PUT", { rechnerMarke: "ceylan" }), { params });
    expect(res.status).toBe(404);
  });

  it("GET ohne Zeile → Vorgabe", async () => {
    const res = await GET(req("GET"), { params });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: { zeitposten: [], rechnerMarke: null } });
    expect(mocks.ladeFirmenEinstellungen).toHaveBeenCalledWith("ws_1", "oc_1");
  });

  it("PUT speichert und gibt die gelesenen Einstellungen zurück", async () => {
    mocks.ladeFirmenEinstellungen.mockResolvedValue({
      zeitposten: [{ id: "klavier", bezeichnung: "Klavier", minuten: 90 }],
      rechnerMarke: "kottke",
    });
    const res = await PUT(
      req("PUT", { zeitposten: [{ id: "klavier", bezeichnung: "Klavier", minuten: 90 }], rechnerMarke: "kottke" }),
      { params }
    );
    expect(res.status).toBe(200);
    expect(mocks.speichereFirmenEinstellungen).toHaveBeenCalledWith("ws_1", "oc_1", {
      zeitposten: [{ id: "klavier", bezeichnung: "Klavier", minuten: 90 }],
      rechnerMarke: "kottke",
    });
    expect(await res.json()).toEqual({
      data: {
        zeitposten: [{ id: "klavier", bezeichnung: "Klavier", minuten: 90 }],
        rechnerMarke: "kottke",
      },
    });
  });

  it("PUT mit zahlung und steuernummer reicht geprüfte Werte durch", async () => {
    const res = await PUT(
      req("PUT", { zahlung: { erinnerungModus: "entwurf", tage: 3 }, steuernummer: "  12/345/67890 " }),
      { params }
    );
    expect(res.status).toBe(200);
    expect(mocks.speichereFirmenEinstellungen).toHaveBeenCalledWith("ws_1", "oc_1", {
      zahlung: { erinnerungModus: "entwurf", tage: 3 },
      steuernummer: "12/345/67890",
    });
  });

  it("PUT mit leerer steuernummer → null", async () => {
    await PUT(req("PUT", { steuernummer: "" }), { params });
    expect(mocks.speichereFirmenEinstellungen).toHaveBeenCalledWith("ws_1", "oc_1", { steuernummer: null });
  });

  it.each([
    [{ zahlung: { tage: 61 } }],
    [{ zahlung: { erinnerungModus: "senden" } }],
    [{ zahlung: { basis: "monatsende" } }],
    [{ zahlung: { gebuehr: 5 } }],
    [{ zahlung: "aus" }],
    [{ steuernummer: 12 }],
  ])("PUT mit ungültigen Zahlungswerten %j → 400", async (body) => {
    const res = await PUT(req("PUT", body), { params });
    expect(res.status).toBe(400);
    expect(mocks.speichereFirmenEinstellungen).not.toHaveBeenCalled();
  });

  it("PUT über API-Schlüssel (Agent) → 403, Nur-Lesen → 403", async () => {
    mocks.getAuthContext.mockResolvedValue({ ...ADMIN, authMethod: "api_key", apiKeyAccess: "full" });
    expect((await PUT(req("PUT", { zahlung: { erinnerungModus: "entwurf" } }), { params })).status).toBe(403);
    mocks.getAuthContext.mockResolvedValue({ ...ADMIN, authMethod: "api_key", apiKeyAccess: "read" });
    expect((await PUT(req("PUT", { zahlung: { erinnerungModus: "entwurf" } }), { params })).status).toBe(403);
    expect(mocks.speichereFirmenEinstellungen).not.toHaveBeenCalled();
  });
});
