import { beforeEach, describe, expect, it, vi } from "vitest";
import { polylineDekodieren } from "@/components/neu/kalkulation/route-karte-bild-logik";
import type { EinsatzPersonLage } from "@/lib/einsatz-ansicht";
import type { Punkt } from "@/lib/einsatz";
import type { OrtAnfrage } from "./einsatz-geo";
import type { KartenLead } from "./einsatz-karte";

const m = vi.hoisted(() => ({ lage: vi.fn() }));
vi.mock("@/db", () => ({ db: {} }));
vi.mock("./einsatz", () => ({ ladeEinsatzLage: m.lage }));

const { ladeEinsatzKarte } = await import("./einsatz-karte");

const JETZT = new Date("2026-11-10T10:00:00Z");
const POLY = "_p~iF~ps|U_ulLnnqC_mqNvxq`@";
const LINIE = polylineDekodieren(POLY);
const NAME = "Anna Müller";

function person(over: Partial<EinsatzPersonLage> & Pick<EinsatzPersonLage, "id" | "name">): EinsatzPersonLage {
  return {
    kuerzel: "XX",
    aktiv: true,
    plz: "70176",
    wohnort: "Stuttgart",
    kannSprinter: false,
    eigenerPkw: false,
    satzFahrtCent: 1500,
    satzArbeitCent: 2000,
    lage: "frei",
    belegtMit: [],
    abwesend: null,
    stempeltGerade: false,
    ...over,
  };
}

function setze(personen: EinsatzPersonLage[], anfrage: Record<string, string> | null, mitVersion = true) {
  m.lage.mockResolvedValue({
    version: mitVersion ? { id: "v1", version: 1, status: "gesperrt", rechnerRequest: anfrage, rechnerResult: null, overrides: [] } : null,
    anfrage,
    personen,
  });
}

function orteFest(punkte: Record<string, Punkt>) {
  return vi.fn(async (_ws: string, anfragen: OrtAnfrage[]) => {
    const map = new Map<string, Punkt>();
    const ohne: string[] = [];
    for (const a of anfragen) {
      const p = punkte[a.schluessel];
      if (p) map.set(a.schluessel, p);
      else ohne.push(a.schluessel);
    }
    return { punkte: map, ohne };
  });
}

const leerLead = vi.fn(async (): Promise<KartenLead | null> => null);

describe("ladeEinsatzKarte", () => {
  beforeEach(() => {
    m.lage.mockReset();
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("fetch nicht gefälscht");
    }));
  });

  it("Route mit Haupt-Teilstrecke: Punkte und Linie, Quelle route, ohne Straße", async () => {
    setze([], { von_adresse: "Königstraße 12, 70173 Stuttgart", nach_adresse: "Bahnhofstraße 2, 73728 Esslingen" });
    const orte = orteFest({});
    const lead = vi.fn();
    const karte = await ladeEinsatzKarte("w1", "d1", {
      jetzt: JETZT,
      orte,
      lead,
      routen: async () => [{ von: "Beladen", nach: "Entladen", km: 12, minuten: 20, polyline: POLY, haupt: true }],
    });
    expect(karte.linie).toEqual(LINIE);
    expect(LINIE.length).toBeGreaterThanOrEqual(2);
    expect(karte.beladen).toEqual({ punkt: LINIE[0], text: "Stuttgart", quelle: "route" });
    expect(karte.entladen).toEqual({ punkt: LINIE[LINIE.length - 1], text: "Esslingen", quelle: "route" });
    expect(lead).not.toHaveBeenCalled();
    expect(orte).not.toHaveBeenCalled();
    const json = JSON.stringify(karte);
    expect(json).not.toContain("Königstraße");
    expect(json).not.toContain("Bahnhofstraße");
    expect(json).not.toContain("12,");
    expect(m.lage).toHaveBeenCalledWith("w1", "d1", { jetzt: JETZT });
  });

  it("Route ohne Entladen: letzter Punkt der Strecke nach Beladen, keine Linie", async () => {
    setze([], null);
    const lead = vi.fn();
    const karte = await ladeEinsatzKarte("w1", "d1", {
      jetzt: JETZT,
      orte: orteFest({}),
      lead,
      routen: async () => [
        { von: "Station", nach: "Beladen", km: 4, minuten: 8, polyline: POLY, haupt: false },
        { von: "Beladen", nach: "Station", km: 4, minuten: 8, polyline: POLY, haupt: false },
      ],
    });
    expect(karte.beladen).toEqual({ punkt: LINIE[LINIE.length - 1], text: "Beladen", quelle: "route" });
    expect(karte.entladen).toBeNull();
    expect(karte.linie).toEqual([]);
    expect(lead).not.toHaveBeenCalled();
  });

  it("leere oder kaputte Polyline zählt als keine Route", async () => {
    for (const polyline of ["", "??"]) {
      setze([], { von_adresse: "70173 Stuttgart" });
      const orte = orteFest({ "70173 stuttgart": [9.18, 48.78] });
      const karte = await ladeEinsatzKarte("w1", "d1", {
        jetzt: JETZT,
        orte,
        lead: leerLead,
        routen: async () => [{ von: "Beladen", nach: "Entladen", km: 1, minuten: 1, polyline, haupt: true }],
      });
      expect(karte.beladen).toEqual({ punkt: [9.18, 48.78], text: "Stuttgart", quelle: "ort" });
      expect(karte.linie).toEqual([]);
    }
  });

  it("nur PLZ lesbar: Anfrage mit PLZ, Anzeige „PLZ 70173“ (Review M2)", async () => {
    setze([], { von_adresse: "70173" });
    const orte = orteFest({ "plz:70173": [9.18, 48.78] });
    const karte = await ladeEinsatzKarte("w1", "d1", { jetzt: JETZT, orte, lead: leerLead, routen: async () => null });
    expect((orte.mock.calls[0]![1] as OrtAnfrage[])[0]).toEqual({ schluessel: "plz:70173", text: "70173", plz: "70173" });
    expect(karte.beladen).toEqual({ punkt: [9.18, 48.78], text: "PLZ 70173", quelle: "ort" });
  });

  it("Ort ohne PLZ ist ungefähr, Straße wird nie Ort (Review M3)", async () => {
    setze([], { von_adresse: "Böblingen, Hauptstraße", nach_adresse: "70173 Stuttgart" });
    const orte = orteFest({ "ort:böblingen": [9.0, 48.68], "70173 stuttgart": [9.18, 48.78] });
    const karte = await ladeEinsatzKarte("w1", "d1", { jetzt: JETZT, orte, lead: leerLead, routen: async () => null });
    expect((orte.mock.calls[0]![1] as OrtAnfrage[]).map((x) => x.schluessel)).toEqual(["ort:böblingen", "70173 stuttgart"]);
    expect(karte.beladen).toEqual({ punkt: [9.0, 48.68], text: "Böblingen", quelle: "ort", ungefaehr: true });
    expect(karte.entladen).toEqual({ punkt: [9.18, 48.78], text: "Stuttgart", quelle: "ort" });
  });

  it("Ort bekannt, aber ohne Kartenpunkt (etwa ohne Geocoding-Freigabe): kein Route-Hinweis", async () => {
    setze([], { von_adresse: "Königstraße 12, 70173 Stuttgart" });
    const karte = await ladeEinsatzKarte("w1", "d1", { jetzt: JETZT, orte: orteFest({}), lead: leerLead, routen: async () => null });
    expect(karte.beladen).toBeNull();
    expect(karte.hinweise).toEqual(["Auftragsort ohne Kartenpunkt."]);
  });

  it("keine Route: Stadtpunkt aus der Version, Text ohne Straße, Beladen vor den Personen", async () => {
    setze(
      [person({ id: "p1", name: NAME, kuerzel: "", plz: "70176", wohnort: "Stuttgart" })],
      { von_adresse: "Königstraße 12, 70173 Stuttgart", nach_adresse: "Bahnhofstraße 2, 73728 Esslingen" },
    );
    const orte = orteFest({
      "70173 stuttgart": [9.18, 48.78],
      "73728 esslingen": [9.31, 48.74],
      "70176 stuttgart": [9.16, 48.77],
    });
    const lead = vi.fn();
    const karte = await ladeEinsatzKarte("w1", "d1", { jetzt: JETZT, orte, lead, routen: async () => null });
    expect(lead).not.toHaveBeenCalled();
    expect(karte.beladen).toEqual({ punkt: [9.18, 48.78], text: "Stuttgart", quelle: "ort" });
    expect(karte.entladen).toEqual({ punkt: [9.31, 48.74], text: "Esslingen", quelle: "ort" });
    expect(karte.linie).toEqual([]);
    expect(karte.personen[0]).toMatchObject({ employeeId: "p1", kuerzel: "AM", punkt: [9.16, 48.77], ortText: "70176 Stuttgart" });
    const anfragen = orte.mock.calls[0]![1] as OrtAnfrage[];
    expect(anfragen.map((a) => a.schluessel)).toEqual(["70173 stuttgart", "73728 esslingen", "70176 stuttgart"]);
    expect(anfragen[2]).toMatchObject({ text: "70176 Stuttgart", plz: "70176" });
    expect(JSON.stringify(anfragen)).not.toContain("Müller");
    const json = JSON.stringify(karte);
    expect(json).not.toContain("Königstraße");
    expect(json).not.toContain("12,");
    expect(json).not.toContain("Bahnhofstraße");
  });

  it("fehlende Seite kommt aus dem Lead, die gesetzte Seite bleibt die Version", async () => {
    setze([], { von_adresse: "70176 Stuttgart" });
    const lead = vi.fn(async (): Promise<KartenLead> => ({
      von: "99999 Woanders",
      nach: "73728 Esslingen",
      chatVon: null,
      chatNach: "71032 Böblingen",
    }));
    const orte = orteFest({ "70176 stuttgart": [9.16, 48.77], "73728 esslingen": [9.31, 48.74] });
    const karte = await ladeEinsatzKarte("w1", "d1", { jetzt: JETZT, orte, lead, routen: async () => null });
    expect(lead).toHaveBeenCalledWith("w1", "d1");
    expect(karte.beladen).toEqual({ punkt: [9.16, 48.77], text: "Stuttgart", quelle: "ort" });
    expect(karte.entladen).toEqual({ punkt: [9.31, 48.74], text: "Esslingen", quelle: "ort" });
  });

  it("keine Adresse in Version und Lead, aber Chat: Quelle chat", async () => {
    setze([], {});
    const lead = vi.fn(async (): Promise<KartenLead> => ({
      von: null,
      nach: null,
      chatVon: "70372 Stuttgart",
      chatNach: "71032 Böblingen",
    }));
    const orte = orteFest({ "70372 stuttgart": [9.2, 48.8], "71032 böblingen": [9.0, 48.68] });
    const karte = await ladeEinsatzKarte("w1", "d1", { jetzt: JETZT, orte, lead, routen: async () => null });
    expect(karte.beladen).toEqual({ punkt: [9.2, 48.8], text: "Stuttgart", quelle: "chat" });
    expect(karte.entladen).toEqual({ punkt: [9.0, 48.68], text: "Böblingen", quelle: "chat" });
  });

  it("gar nichts: Hinweis, auch wenn der Lead wirft; Wohnort fehlt und zählt nicht mit", async () => {
    setze([person({ id: "o", name: "Ohne", wohnort: null, plz: null, kuerzel: "O" })], null, false);
    const orte = orteFest({});
    const routen = vi.fn();
    const karte = await ladeEinsatzKarte("w1", "d1", {
      jetzt: JETZT,
      orte,
      routen,
      lead: async () => {
        throw new Error("lead kaputt");
      },
    });
    expect(routen).not.toHaveBeenCalled();
    expect(orte).not.toHaveBeenCalled();
    expect(karte.beladen).toBeNull();
    expect(karte.entladen).toBeNull();
    expect(karte.linie).toEqual([]);
    expect(karte.hinweise).toEqual(["Noch keine Route: erst die Kalkulation rechnen."]);
    expect(karte.personen).toEqual([
      { employeeId: "o", name: "Ohne", kuerzel: "O", ortText: null, ortSchluessel: null, punkt: null, lage: "frei" },
    ]);
  });

  it("inaktive fehlen, gleicher Ort ein Schlüssel, Kürzel aus dem Namen", async () => {
    setze([
      person({ id: "a", name: "Max Kottke", kuerzel: "", plz: "70176", wohnort: "Stuttgart" }),
      person({ id: "b", name: "Bea Kurz", kuerzel: "BK", plz: "70176", wohnort: "Stuttgart", lage: "belegt" }),
      person({ id: "i", name: "Ina", aktiv: false, plz: "73728", wohnort: "Esslingen" }),
    ], null, false);
    const orte = orteFest({ "70176 stuttgart": [9.16, 48.77] });
    const karte = await ladeEinsatzKarte("w1", "d1", { jetzt: JETZT, orte, lead: async () => null, routen: async () => null });
    expect(karte.personen.map((p) => p.employeeId)).toEqual(["a", "b"]);
    expect(karte.personen.map((p) => p.kuerzel)).toEqual(["MK", "BK"]);
    expect(karte.personen.map((p) => p.punkt)).toEqual([[9.16, 48.77], [9.16, 48.77]]);
    expect((orte.mock.calls[0]![1] as OrtAnfrage[]).map((a) => a.schluessel)).toEqual(["70176 stuttgart"]);
  });

  it("verschiedene Personen-Orte ohne Punkt, Wohnort ohne Ort zählt nicht", async () => {
    setze([
      person({ id: "a1", name: "Anna", plz: "70176", wohnort: "Stuttgart" }),
      person({ id: "a2", name: "Adam", plz: "70176", wohnort: "Stuttgart" }),
      person({ id: "b", name: "Bert", plz: "73728", wohnort: "Esslingen" }),
      person({ id: "o", name: "Ohne", wohnort: null, plz: "70173", kuerzel: "O" }),
      person({ id: "i", name: "Ina", aktiv: false, plz: "72070", wohnort: "Tübingen" }),
    ], null);
    const orte = orteFest({});
    const karte = await ladeEinsatzKarte("w1", "d1", {
      jetzt: JETZT,
      orte,
      lead: async () => null,
      routen: async () => [{ von: "Beladen", nach: "Entladen", km: 1, minuten: 1, polyline: POLY, haupt: true }],
    });
    expect(karte.hinweise).toEqual(["2 Orte ohne Kartenpunkt."]);
    expect(karte.personen.map((p) => p.employeeId)).toEqual(["a1", "a2", "b", "o"]);
    expect(karte.personen.find((p) => p.employeeId === "o")).toMatchObject({ punkt: null, ortSchluessel: null });
    expect((orte.mock.calls[0]![1] as OrtAnfrage[]).map((a) => a.schluessel)).toEqual(["70176 stuttgart", "73728 esslingen"]);
  });

  it("ein Ort ohne Kartenpunkt in der Einzahl", async () => {
    setze([person({ id: "a", name: "Anna" })], null);
    const karte = await ladeEinsatzKarte("w1", "d1", {
      jetzt: JETZT,
      orte: orteFest({}),
      lead: async () => null,
      routen: async () => [{ von: "Beladen", nach: "Entladen", km: 1, minuten: 1, polyline: POLY, haupt: true }],
    });
    expect(karte.hinweise).toEqual(["1 Ort ohne Kartenpunkt."]);
  });
});
