import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getAuthContext: vi.fn(),
  ensureDealCalculation: vi.fn(),
  hatPaketoptionen: vi.fn(),
  lesen: vi.fn(),
  entwurfHolenOderAnlegen: vi.fn(),
  uebersteuern: vi.fn(),
  sperren: vi.fn(),
}));

vi.mock("@/lib/api-utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-utils")>();
  return { ...actual, getAuthContext: mocks.getAuthContext };
});
vi.mock("@/services/rechner/kalkulation", () => ({ ensureDealCalculation: mocks.ensureDealCalculation }));
vi.mock("@/services/rechner/pakete", () => ({ hatPaketoptionen: mocks.hatPaketoptionen }));
vi.mock("@/services/rechner/speicher", () => ({ dbSpeicher: { lesen: mocks.lesen, speichern: vi.fn() } }));
// Der Versionen-Dienst ist in services/kalkulation-versionen.test.ts geprüft; hier nur die Route.
vi.mock("@/services/kalkulation-versionen", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/kalkulation-versionen")>();
  return {
    ...actual,
    entwurfHolenOderAnlegen: mocks.entwurfHolenOderAnlegen,
    uebersteuern: mocks.uebersteuern,
    sperren: mocks.sperren,
  };
});

import { GET, POST } from "./route";
import { POST as APPLY } from "./apply/route";
import { VersionsFehler } from "@/services/kalkulation-versionen";
import { UebersteuerungFehler } from "@/lib/kalkulation-versionen";
import { AngebotAngenommenError } from "@/services/kva-annahme";

const CTX = { userId: "usr_1", workspaceId: "ws_1", workspaceRole: "admin" as const };
const params = Promise.resolve({ recordId: "deal_1" });
const req = (body?: unknown) =>
  new NextRequest("http://localhost/api/v1/deals/deal_1/calculation", {
    method: "POST", body: body === undefined ? undefined : JSON.stringify(body), headers: { "content-type": "application/json" },
  });
const zeile = (result: unknown) => ({
  dealRecordId: "deal_1", workspaceId: "ws_1", inputHash: "h", request: { von_etage: "1" }, result, error: null, computedAt: new Date(),
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getAuthContext.mockResolvedValue(CTX);
  mocks.hatPaketoptionen.mockResolvedValue(false);
  mocks.entwurfHolenOderAnlegen.mockResolvedValue({ version: { version: 1, status: "entwurf" }, neu: true });
  mocks.uebersteuern.mockResolvedValue({ version: { version: 1, status: "entwurf" }, neu: false });
  mocks.sperren.mockResolvedValue({
    version: { version: 1, status: "gesperrt" }, quotation: { id: "q1", fixedPrice: "1490.00", notes: "Klavier" }, gueltigkeitHinweis: null,
  });
});

describe("GET/POST /calculation", () => {
  it("ohne Anmeldung 401", async () => {
    mocks.getAuthContext.mockResolvedValue(null);
    expect((await GET(req(), { params })).status).toBe(401);
    expect((await POST(req(), { params })).status).toBe(401);
    expect((await APPLY(req({}), { params })).status).toBe(401);
  });

  it("GET rechnet bei Bedarf (ohne force) und liefert die Kalkulation", async () => {
    mocks.ensureDealCalculation.mockResolvedValue({ status: "unveraendert", kalkulation: zeile({ preis: { festpreis: 900 } }) });
    const res = await GET(req(), { params });
    expect(res.status).toBe(200);
    expect(mocks.ensureDealCalculation).toHaveBeenCalledWith("ws_1", "deal_1", { force: false });
    expect((await res.json()).data.kalkulation.result.preis.festpreis).toBe(900);
  });

  it("POST rechnet erzwungen neu", async () => {
    mocks.ensureDealCalculation.mockResolvedValue({ status: "neu", kalkulation: zeile({}) });
    await POST(req(), { params });
    expect(mocks.ensureDealCalculation).toHaveBeenCalledWith("ws_1", "deal_1", { force: true });
  });

  it("ein Absturz in der Kalkulation macht die Seite nicht kaputt: letzte gespeicherte Kalkulation, Status fehler", async () => {
    mocks.ensureDealCalculation.mockRejectedValue(new Error("DB weg"));
    mocks.lesen.mockResolvedValue(zeile({ preis: { festpreis: 800 } }));
    const res = await GET(req(), { params });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.status).toBe("fehler");
    expect(body.data.kalkulation.result.preis.festpreis).toBe(800);
  });
});

describe("POST /calculation/apply", () => {
  const MENSCH = { userId: "usr_1", quelle: "mensch" };
  const fehlerText = async (res: Response) => (await res.json()).error.message as string;

  it("ohne Marge: Entwurf holen, sperren; Antwort {...quotation, gueltigkeitHinweis}", async () => {
    mocks.sperren.mockResolvedValue({
      version: { version: 1, status: "gesperrt" }, quotation: { id: "q1", fixedPrice: "1490.00", notes: "Klavier" },
      gueltigkeitHinweis: "Umzug in 3 Tagen: Angebot gilt bis zum Umzugstag.",
    });
    const res = await APPLY(req({}), { params });
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({
      id: "q1", fixedPrice: "1490.00", notes: "Klavier", gueltigkeitHinweis: "Umzug in 3 Tagen: Angebot gilt bis zum Umzugstag.",
    });
    expect(mocks.entwurfHolenOderAnlegen).toHaveBeenCalledWith("ws_1", "deal_1", MENSCH);
    expect(mocks.uebersteuern).not.toHaveBeenCalled();
    expect(mocks.sperren).toHaveBeenCalledWith("ws_1", "deal_1", 1, MENSCH, { bestaetigtSpanne: false });
  });

  it("{ margeProzent: 45 }: Marge als Übersteuerung, dann den Entwurf sperren", async () => {
    mocks.entwurfHolenOderAnlegen.mockResolvedValue({ version: { version: 3, status: "entwurf" }, neu: true });
    mocks.uebersteuern.mockResolvedValue({ version: { version: 3, status: "entwurf" }, neu: false });
    const res = await APPLY(req({ margeProzent: 45, bestaetigtSpanne: true }), { params });
    expect(res.status).toBe(200);
    expect((await res.json()).data).toHaveProperty("gueltigkeitHinweis", null);
    expect(mocks.uebersteuern).toHaveBeenCalledWith(
      "ws_1", "deal_1", 3, { art: "marge", key: "marge", wert: 45, grund: "Marge im Regler gewählt" }, MENSCH
    );
    expect(mocks.sperren).toHaveBeenCalledWith("ws_1", "deal_1", 3, MENSCH, { bestaetigtSpanne: true });
    expect(mocks.uebersteuern.mock.invocationCallOrder[0]).toBeLessThan(mocks.sperren.mock.invocationCallOrder[0]);
  });

  it("ohne margeProzent, Entwurf erbt eine Marge: Marge aufheben (Vorschlag des Rechners wie auf der Karte), dann sperren", async () => {
    mocks.entwurfHolenOderAnlegen.mockResolvedValue({
      version: { version: 2, status: "entwurf", overrides: [{ art: "marge", key: "marge", wert: 50 }] }, neu: true,
    });
    mocks.uebersteuern.mockResolvedValue({ version: { version: 2, status: "entwurf" }, neu: false });
    expect((await APPLY(req({}), { params })).status).toBe(200);
    expect(mocks.uebersteuern).toHaveBeenCalledWith(
      "ws_1", "deal_1", 2, { art: "marge", key: "marge", wert: null, grund: "Kalkulationskarte ohne Margenwahl: Vorschlag des Rechners" }, MENSCH
    );
    expect(mocks.sperren).toHaveBeenCalledWith("ws_1", "deal_1", 2, MENSCH, { bestaetigtSpanne: false });
  });

  it("ohne margeProzent, geerbte Marge schon aufgehoben: keine weitere Übersteuerung", async () => {
    mocks.entwurfHolenOderAnlegen.mockResolvedValue({
      version: { version: 2, status: "entwurf", overrides: [{ art: "marge", key: "marge", wert: 50 }, { art: "marge", key: "marge", wert: null }] },
      neu: false,
    });
    await APPLY(req({}), { params });
    expect(mocks.uebersteuern).not.toHaveBeenCalled();
  });

  it("API-Schlüssel: Autor ist der Agent", async () => {
    mocks.getAuthContext.mockResolvedValue({ ...CTX, authMethod: "api_key" });
    await APPLY(req({}), { params });
    expect(mocks.sperren).toHaveBeenCalledWith("ws_1", "deal_1", 1, { userId: "usr_1", quelle: "agent" }, { bestaetigtSpanne: false });
  });

  it("Marge außerhalb 30 bis 60 oder kein Zahlwert: 400 mit dem heutigen Text, kein Entwurf", async () => {
    for (const margeProzent of [25, 61, "45"]) {
      const res = await APPLY(req({ margeProzent }), { params });
      expect(res.status).toBe(400);
      expect(await fehlerText(res)).toBe("Marge muss zwischen 30 und 60 % liegen.");
    }
    expect(mocks.entwurfHolenOderAnlegen).not.toHaveBeenCalled();
  });

  it("nur Spanne ohne Bestätigung (VersionsFehler SPANNE): 400 mit dessen Text", async () => {
    mocks.sperren.mockRejectedValue(new VersionsFehler("SPANNE", "Nur eine Spanne vorhanden. Obergrenze übernehmen? (bestaetigtSpanne)"));
    const res = await APPLY(req({}), { params });
    expect(res.status).toBe(400);
    expect(await fehlerText(res)).toBe("Nur eine Spanne vorhanden. Obergrenze übernehmen? (bestaetigtSpanne)");
  });

  it("Deal eines anderen Workspace (Lead nicht gefunden): 400, nichts gesperrt", async () => {
    mocks.entwurfHolenOderAnlegen.mockRejectedValue(new VersionsFehler("NICHT_GEFUNDEN", "Deal nicht gefunden."));
    const res = await APPLY(req({}), { params });
    expect(res.status).toBe(400);
    expect(mocks.sperren).not.toHaveBeenCalled();
  });

  it("übernimmt nur eine aktuelle Kalkulation; Rechnerfehler → 400 mit Grund (Review Sol/Grok)", async () => {
    mocks.sperren.mockRejectedValue(new VersionsFehler("RECHNER_FEHLER", "Kalkulation nicht aktuell: Rechner nicht erreichbar."));
    const res = await APPLY(req({}), { params });
    expect(res.status).toBe(400);
    expect(await fehlerText(res)).toMatch(/nicht erreichbar/);
  });

  it("Stunden-KV und ungültige Übersteuerung: 400", async () => {
    mocks.sperren.mockRejectedValueOnce(new VersionsFehler("STUNDEN", "Das Angebot ist ein Stunden-KV."));
    expect((await APPLY(req({}), { params })).status).toBe(400);
    mocks.uebersteuern.mockRejectedValueOnce(new UebersteuerungFehler("Marge zwischen 30 und 60 %"));
    expect((await APPLY(req({ margeProzent: 45 }), { params })).status).toBe(400);
  });

  it("Kunde hat angenommen: 409 KVA_ACCEPTED", async () => {
    mocks.sperren.mockRejectedValue(new AngebotAngenommenError());
    const res = await APPLY(req({}), { params });
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("KVA_ACCEPTED");
  });

  it("Lead mit Paketoptionen: 400 mit dem heutigen Text, kein Entwurf und keine Meldung (Review Grok)", async () => {
    mocks.hatPaketoptionen.mockResolvedValue(true);
    const res = await APPLY(req({ margeProzent: 45 }), { params });
    expect(res.status).toBe(400);
    expect(await fehlerText(res)).toMatch(/Paket/);
    expect(mocks.entwurfHolenOderAnlegen).not.toHaveBeenCalled();
    expect(mocks.uebersteuern).not.toHaveBeenCalled();
    expect(mocks.sperren).not.toHaveBeenCalled();
  });

  it("unerwarteter Fehler wird weitergeworfen", async () => {
    mocks.sperren.mockRejectedValue(new Error("DB weg"));
    await expect(APPLY(req({}), { params })).rejects.toThrow("DB weg");
  });
});
