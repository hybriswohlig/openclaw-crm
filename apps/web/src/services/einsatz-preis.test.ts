import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  stationen: [] as Array<{ id: string; name: string; anbieter: string | null; aktiv: boolean }>,
  klassen: [] as Array<{ id: string; anbieter: string | null; aktiv: boolean }>,
  fehler: false,
}));
vi.mock("@/db", () => ({ db: {} }));
vi.mock("@/services/einsatz-buchungen", () => ({
  dealBuchung: async () => ({
    id: "b1", firmaId: "f", von: "2026-11-17", bis: "2026-11-23", stationId: "st1", stationName: "Sixt", stationAnbieter: "sixt",
    klasseId: "kl1", klasseName: "Sprinter L", mieteCent: 45000, inklusivKm: null, mehrkmSatzCent: null, geplanteAuftraege: 3, status: "geplant", notiz: null,
  }),
}));
vi.mock("@/services/rechner/stammdaten", () => ({
  rechnerStationen: async () => {
    if (m.fehler) throw new Error("weg");
    return m.stationen;
  },
  rechnerKlassen: async () => m.klassen,
}));

const { einsatzPreisKontext, HINWEIS_ANBIETER_PASST_NICHT, HINWEIS_AUS_BUCHUNG, HINWEIS_BUCHUNG_FEHLT_IM_RECHNER } = await import("./einsatz-preis");
const an = async () => ({ buchungImPreis: true });

describe("einsatzPreisKontext", () => {
  beforeEach(() => {
    m.stationen = [{ id: "st1", name: "Sixt", anbieter: "sixt", aktiv: true }];
    m.klassen = [{ id: "kl1", anbieter: "sixt", aktiv: true }];
    m.fehler = false;
  });

  it("Schalter aus: nichts", async () => {
    expect(await einsatzPreisKontext("w", "d", async () => ({ buchungImPreis: false }))).toBeNull();
  });

  it("passende Station und Klasse: Buchung im Preis", async () => {
    const k = await einsatzPreisKontext("w", "d", an);
    expect(k?.hinweis).toBe(HINWEIS_AUS_BUCHUNG);
    expect(k?.anfrage.buchung?.anteil.anteilCent).toBe(15000);
  });

  it("Review M8: Anbieter von Klasse und Station passen nicht: klarer Hinweis, keine Buchung an den Rechner", async () => {
    m.klassen = [{ id: "kl1", anbieter: "europcar", aktiv: true }];
    expect(await einsatzPreisKontext("w", "d", an)).toEqual({ anfrage: { station: null, klasse: null, buchung: null }, hinweis: HINWEIS_ANBIETER_PASST_NICHT });
  });

  it("Klasse fehlt im Rechner: Hinweis; Rechner nicht erreichbar: Buchung geht trotzdem mit", async () => {
    m.klassen = [];
    expect((await einsatzPreisKontext("w", "d", an))?.hinweis).toBe(HINWEIS_BUCHUNG_FEHLT_IM_RECHNER);
    m.fehler = true;
    expect((await einsatzPreisKontext("w", "d", an))?.anfrage.buchung).not.toBeNull();
  });
});
