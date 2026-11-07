import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getAuthContext: vi.fn(),
  neuenLeadAnlegen: vi.fn(),
}));

vi.mock("@/db", () => ({
  db: new Proxy({}, { get(_t, p) { if (p === "then" || typeof p === "symbol") return undefined; throw new Error(`@/db im Test (${String(p)})`); } }),
}));
vi.mock("@/lib/api-utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-utils")>();
  return { ...actual, getAuthContext: mocks.getAuthContext };
});
vi.mock("@/services/lead-anlegen", () => ({ neuenLeadAnlegen: mocks.neuenLeadAnlegen }));

import { NEUER_LEAD_TEXT } from "@/lib/handy-links";
import { POST } from "./route";

const CTX = { userId: "usr_1", workspaceId: "ws_1", workspaceRole: "admin" as const, authMethod: "cookie" as const };
const GUT = {
  name: "Ada Lovelace",
  telefon: "0151 59058963",
  email: "ada@example.com",
  firmaId: "firma_1",
  quelle: "Telefon",
  umzugsdatum: "2026-12-01",
};

const post = (body: unknown) =>
  new NextRequest("http://localhost/api/v1/leads", {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getAuthContext.mockResolvedValue(CTX);
  mocks.neuenLeadAnlegen.mockResolvedValue({ ok: true, dealRecordId: "deal_1", personRecordId: "person_1" });
});

describe("POST /leads", () => {
  it("ohne Anmeldung 401", async () => {
    mocks.getAuthContext.mockResolvedValue(null);
    expect((await POST(post(GUT))).status).toBe(401);
    expect(mocks.neuenLeadAnlegen).not.toHaveBeenCalled();
  });

  it("Nur-lesen-Schlüssel 403", async () => {
    mocks.getAuthContext.mockResolvedValue({ ...CTX, authMethod: "api_key", apiKeyAccess: "read" });
    expect((await POST(post(GUT))).status).toBe(403);
    expect(mocks.neuenLeadAnlegen).not.toHaveBeenCalled();
  });

  it("ungültiges JSON 400", async () => {
    expect((await POST(post("{kaputt"))).status).toBe(400);
    expect(mocks.neuenLeadAnlegen).not.toHaveBeenCalled();
  });

  it("400 je Feld, Firma aus einem anderen Workspace ebenfalls", async () => {
    const faelle: [string, Record<string, unknown>, string][] = [
      ["name", { ...GUT, name: "A" }, "name"],
      ["kontakt", { name: "Ada Lovelace", firmaId: "firma_1", quelle: "Telefon" }, "kontakt"],
      ["email", { ...GUT, telefon: null, email: "keine-adresse" }, "email"],
      ["firma", { ...GUT, firmaId: "!!" }, "firma"],
      ["quelle", { ...GUT, quelle: "Rauchzeichen" }, "quelle"],
      ["umzugsdatum", { ...GUT, umzugsdatum: "gestern" }, "umzugsdatum"],
      ["personWahl", { ...GUT, personWahl: { art: "bestehend" } }, "personWahl"],
    ];
    for (const [label, body, feld] of faelle) {
      const res = await POST(post(body));
      expect(res.status, label).toBe(400);
      expect((await res.json()).error.feld, label).toBe(feld);
    }
    expect(mocks.neuenLeadAnlegen).not.toHaveBeenCalled();

    mocks.neuenLeadAnlegen.mockResolvedValueOnce({ ok: false, code: "FIRMA" });
    const firma = await POST(post(GUT));
    expect(firma.status).toBe(400);
    expect(await firma.json()).toEqual({
      error: { code: "UNGUELTIG", feld: "firma", message: NEUER_LEAD_TEXT.firma },
    });
  });

  it("409 mit den Treffern, wenn die Nummer schon Kunden hat", async () => {
    const treffer = [{ id: "person_1", name: "Ada" }];
    mocks.neuenLeadAnlegen.mockResolvedValue({ ok: false, code: "RUECKFRAGE", treffer });
    const res = await POST(post(GUT));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: { code: "RUECKFRAGE", message: "Zu dieser Nummer gibt es schon Kunden." },
      treffer,
    });
  });

  it("201 mit Deal und Person", async () => {
    const res = await POST(post(GUT));
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ data: { ok: true, dealRecordId: "deal_1", personRecordId: "person_1" } });
    expect(mocks.neuenLeadAnlegen).toHaveBeenCalledWith(
      "ws_1",
      {
        name: "Ada Lovelace",
        telefon: "0151 59058963",
        email: "ada@example.com",
        firmaId: "firma_1",
        quelle: "Telefon",
        umzugsdatum: "2026-12-01",
        personWahl: null,
      },
      "usr_1"
    );
  });
});
