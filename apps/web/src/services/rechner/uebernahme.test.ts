import { describe, expect, it } from "vitest";
import { angebotsUebernahme } from "./uebernahme";
import type { RechnerErgebnis } from "./client";

const festpreisErgebnis: RechnerErgebnis = {
  preis: { festpreis: 1490 },
  zeiten: { fahrtMin: 55 },
  volumen: { nettoCbm: 18.4 },
  positionen: [{ name: "Sofa", menge: 1, volumenCbm: 1.6 }, { name: "Schrank", menge: 2, volumenCbm: 1.8 }],
  mietstation: { name: "SIXT Sindelfingen", anbieter: "Sixt", adresse: "x", quelle: "google", anfahrtKm: 19, anfahrtMin: 21, rueckfahrtKm: 4, rueckfahrtMin: 9 },
  annahmen: ["Tragestrecke an der Beladeadresse unbekannt: 10 m angenommen."],
  schaetzung: null,
};
const anfrage = { von_etage: "3", von_aufzug: "keiner", nach_etage: "0", nach_aufzug: "klein" };

describe("angebotsUebernahme", () => {
  it("Festpreis wird übernommen, Notizen bleiben, Positionen werden nicht angefasst", () => {
    const r = angebotsUebernahme({ result: festpreisErgebnis, request: anfrage }, { notes: "Klavier im Keller", isVariable: true }, {});
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.eingabe).toMatchObject({ fixedPrice: "1490", isVariable: false, notes: "Klavier im Keller" });
    expect(r.eingabe).not.toHaveProperty("lineItems");
    expect(r.eingabe.calculationAssumptions).toMatchObject({
      anfahrtMinuten: 55, anfahrtQuelle: "berechnet", etageVon: "3", etageBis: "0",
      zugangVon: "ohne Aufzug", zugangBis: "kleiner Aufzug", inventarPositionen: 3, inventarVolumenCbm: 18.4,
    });
    expect(r.eingabe.calculationAssumptions?.hinweis).toContain("SIXT Sindelfingen");
    expect(r.eingabe.calculationAssumptions?.hinweis).toContain("Tragestrecke");
  });

  it("nur eine Spanne: ohne Bestätigung abgelehnt, mit Bestätigung die Obergrenze", () => {
    const spanne: RechnerErgebnis = { ...festpreisErgebnis, schaetzung: { festpreisVon: 900, festpreisBis: 1800, annahmen: ["Etage unbekannt"] } };
    expect(angebotsUebernahme({ result: spanne, request: {} }, null, {})).toEqual({
      ok: false, fehler: "Nur eine Spanne vorhanden. Obergrenze übernehmen? (bestaetigtSpanne)",
    });
    const r = angebotsUebernahme({ result: spanne, request: {} }, null, { bestaetigtSpanne: true });
    expect(r.ok && r.eingabe.fixedPrice).toBe("1800");
    expect(r.ok && r.eingabe.calculationAssumptions?.hinweis).toContain("Schnellschätzung 900 bis 1800 €");
  });

  it("ohne Ergebnis oder ohne Preis: verständlicher Fehler", () => {
    expect(angebotsUebernahme(null, null, {})).toEqual({ ok: false, fehler: "Noch keine Kalkulation vorhanden." });
    expect(angebotsUebernahme({ result: { preis: { festpreis: null, nichtKalkulierbarGrund: "Keine Arbeit erfasst" } }, request: {} }, null, {}))
      .toEqual({ ok: false, fehler: "Kein Preis kalkulierbar: Keine Arbeit erfasst" });
  });

  it("Fahrzeiten ohne Google gelten als manuell", () => {
    const r = angebotsUebernahme({ result: { ...festpreisErgebnis, mietstation: { ...festpreisErgebnis.mietstation!, quelle: "angenommen" } }, request: anfrage }, null, {});
    expect(r.ok && r.eingabe.calculationAssumptions?.anfahrtQuelle).toBe("manuell");
  });
});

const mitMarge = {
  ...festpreisErgebnis,
  kosten: { selbstkosten: 700 },
  preis: {
    festpreis: 1170, selbstkosten: 700, rundungEur: 10, margeWirksamProzent: 40, margeQuelle: "vorschlag" as const,
    margeVorschlag: { prozent: 40, gruende: [{ text: "Basis Kottke", punkte: 40 }] }, nichtKalkulierbarGrund: null,
  },
};
const jetzt = new Date("2026-09-28T10:00:00Z");

describe("angebotsUebernahme mit Marge", () => {
  it("gewählte Marge: Preis wird serverseitig aus Selbstkosten gerechnet, Annahmen dokumentieren die Wahl", () => {
    const r = angebotsUebernahme({ result: mitMarge, request: anfrage }, null, { margeProzent: 30, uebernommenVon: "mensch", jetzt });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.eingabe.fixedPrice).toBe("1000");
    expect(r.eingabe.calculationAssumptions).toMatchObject({
      selbstkosten: 700, margeVorschlagProzent: 40, margeGewaehltProzent: 30, margeTatsaechlichProzent: 30,
      margeGruende: [{ text: "Basis Kottke", punkte: 40 }], uebernommenVon: "mensch", uebernommenAm: "2026-09-28T10:00:00.000Z",
    });
  });

  it("ohne gewählte Marge: Vorschlag des Rechners", () => {
    const r = angebotsUebernahme({ result: mitMarge, request: anfrage }, null, { jetzt });
    expect(r.ok && r.eingabe.fixedPrice).toBe("1170");
  });

  it("Marge unter 30 oder über 60 wird abgelehnt", () => {
    for (const m of [25, 29.9, 61, Number.NaN]) {
      expect(angebotsUebernahme({ result: mitMarge, request: anfrage }, null, { margeProzent: m })).toEqual({ ok: false, fehler: "Marge muss zwischen 30 und 60 % liegen." });
    }
  });

  it("alte Kalkulation ohne Selbstkosten/Rundung im Preis: Marge nicht übernehmbar", () => {
    expect(angebotsUebernahme({ result: festpreisErgebnis, request: anfrage }, null, { margeProzent: 35 }))
      .toEqual({ ok: false, fehler: "Kalkulation veraltet, bitte neu rechnen." });
  });

  it("Spanne mit gewählter Marge: Obergrenze aus selbstkostenBis", () => {
    const spanne = { ...mitMarge, schaetzung: { festpreisVon: 800, festpreisBis: 1170, selbstkostenVon: 480, selbstkostenBis: 700, margeProzent: 40, annahmen: [] } };
    const r = angebotsUebernahme({ result: spanne, request: {} }, null, { bestaetigtSpanne: true, margeProzent: 35, jetzt });
    // 700 ÷ 0,65 = 1.076,92 → 1.080
    expect(r.ok && r.eingabe.fixedPrice).toBe("1080");
  });

  it("Review Focus 4: ein inkonsistenter gespeicherter Festpreis wird ignoriert, der Preis kommt aus den Selbstkosten", () => {
    const manipuliert = { ...mitMarge, preis: { ...mitMarge.preis, festpreis: 5000 } };
    const r = angebotsUebernahme({ result: manipuliert, request: anfrage }, null, { margeProzent: 30, jetzt });
    expect(r.ok && r.eingabe.fixedPrice).toBe("1000");
  });
});
