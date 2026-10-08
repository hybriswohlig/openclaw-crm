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
  it("Festpreis wird übernommen, Notizen bleiben, Posten ergeben genau den Festpreis (Stand 2026-09-29)", () => {
    const r = angebotsUebernahme({ result: festpreisErgebnis, request: anfrage }, { notes: "Klavier im Keller", isVariable: true }, {});
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.eingabe).toMatchObject({ fixedPrice: "1490", isVariable: false, notes: "Klavier im Keller" });
    // Früher blieben alte Positionen stehen; der KV rechnete dann mit einer anderen Summe als dem Festpreis.
    expect(r.eingabe.lineItems.reduce((s, li) => s + Number(li.unitRate) * li.quantity, 0)).toBe(1490);
    expect(r.eingabe.documentDetails.services?.transport).toMatchObject({ owner: "company" });
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

  it("R9: Marge bei nicht kalkulierbarem Ergebnis wird abgelehnt statt 0 Euro", () => {
    const nk = { preis: { festpreis: null, selbstkosten: 0, rundungEur: 10, nichtKalkulierbarGrund: "Keine Arbeit erfasst" }, kosten: { selbstkosten: 0 } };
    expect(angebotsUebernahme({ result: nk, request: {} }, null, { margeProzent: 35 }))
      .toEqual({ ok: false, fehler: "Kein Preis kalkulierbar: Keine Arbeit erfasst" });
  });

  it("R11: Spanne mit Marge ohne selbstkostenBis ist veraltet; ohne festpreisBis nicht kalkulierbar", () => {
    const alt = { ...mitMarge, schaetzung: { festpreisVon: 800, festpreisBis: 1170, annahmen: [] } };
    expect(angebotsUebernahme({ result: alt, request: {} }, null, { bestaetigtSpanne: true, margeProzent: 35 }))
      .toEqual({ ok: false, fehler: "Kalkulation veraltet, bitte neu rechnen." });
    const leer = { ...mitMarge, schaetzung: { festpreisVon: null, festpreisBis: null, annahmen: [] } };
    expect(angebotsUebernahme({ result: leer, request: {} }, null, { bestaetigtSpanne: true, margeProzent: 35 }))
      .toEqual({ ok: false, fehler: "Kein Preis kalkulierbar." });
  });

  it("R12: Hinweis der Spanne mit Marge nennt die bei der Marge neu gerechnete Spanne", () => {
    const spanne = { ...mitMarge, schaetzung: { festpreisVon: 800, festpreisBis: 1170, selbstkostenVon: 480, selbstkostenBis: 700, margeProzent: 40, annahmen: [] } };
    const r = angebotsUebernahme({ result: spanne, request: {} }, null, { bestaetigtSpanne: true, margeProzent: 35, jetzt });
    // 480 / 0,65 = 738,46 -> 740
    expect(r.ok && r.eingabe.calculationAssumptions?.hinweis).toContain("Schnellschätzung 740 bis 1080 €");
    expect(r.ok && r.eingabe.calculationAssumptions?.hinweis).not.toContain("1170");
    expect(r.ok && r.eingabe.calculationAssumptions?.selbstkosten).toBe(700);
  });

  it("R13: Vorschlagspfad dokumentiert gewählt 40, tatsächlich 40.2, von Mensch", () => {
    const r = angebotsUebernahme({ result: mitMarge, request: anfrage }, null, { jetzt });
    expect(r.ok && r.eingabe.calculationAssumptions).toMatchObject({ margeGewaehltProzent: 40, margeTatsaechlichProzent: 40.2, uebernommenVon: "mensch" });
  });

  it("R13: Spanne ohne Marge zeichnet Selbstkosten und Marge der Spanne auf", () => {
    const spanne = { ...mitMarge, schaetzung: { festpreisVon: 800, festpreisBis: 1170, selbstkostenVon: 480, selbstkostenBis: 650, margeProzent: 45, annahmen: [] } };
    const r = angebotsUebernahme({ result: spanne, request: {} }, null, { bestaetigtSpanne: true, jetzt });
    expect(r.ok && r.eingabe.calculationAssumptions).toMatchObject({ selbstkosten: 650, margeGewaehltProzent: 45 });
  });

  it("R13: gespeicherter Preis unter der 30-%-Grenze wird auch ohne Marge abgelehnt", () => {
    const zuNiedrig = { ...mitMarge, preis: { ...mitMarge.preis, festpreis: 990 } };
    expect(angebotsUebernahme({ result: zuNiedrig, request: anfrage }, null, { jetzt }))
      .toEqual({ ok: false, fehler: "Preis liegt unter der Mindestmarge von 30 %, bitte neu rechnen." });
    const genau = { ...mitMarge, preis: { ...mitMarge.preis, festpreis: 1000 } };
    expect(angebotsUebernahme({ result: genau, request: anfrage }, null, { jetzt }).ok).toBe(true);
  });
});

describe("angebotsUebernahme für den KV", () => {
  const mitHebeln: RechnerErgebnis = {
    preis: { festpreis: 1730, selbstkosten: 1100, rundungEur: 10, posten: [{ bezeichnung: "Halteverbotszone", menge: 2, einheit: "Stück", satz: 150, betrag: 300 }] },
    kosten: { selbstkosten: 1100, posten: [{ bezeichnung: "Halteverbotszone", menge: 2, einheit: "Stück", satz: 120, betrag: 240 }] },
    zeiten: { demontage: 84, montage: 114 },
    team: { groesse: 4 },
    positionen: [{ name: "Boxspringbett", menge: 1, volumenCbm: 2, zerlegt: true }],
    schaetzung: null,
  };
  const req = { von_adresse: "Lerchenstraße 78, 70176 Stuttgart", nach_adresse: "Friedenstraße 5, 70190 Stuttgart", von_halteverbot: "on", nach_halteverbot: "on", umzugsdatum: "2026-10-02" };
  const jetzt = new Date("2026-09-29T10:00:00Z");

  it("Endpreis vom Inhaber, Gültigkeit bis zum Tag vor dem Umzug", () => {
    const r = angebotsUebernahme({ result: mitHebeln, request: req }, null, { endpreis: 2260, jetzt });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.eingabe.fixedPrice).toBe("2260");
    expect(r.eingabe.validUntil).toBe("2026-10-01");
    expect(r.gueltigkeitHinweis).toContain("3 Tagen");
    expect(r.montage).toEqual({ moebel: ["Boxspringbett"], durchUns: true });
    expect(r.eingabe.documentDetails.services?.parkingDestination).toMatchObject({ owner: "company" });
  });

  it("ohne Halteverbot senkt den Rechnerpreis um die Zonen", () => {
    const r = angebotsUebernahme({ result: mitHebeln, request: req }, null, { optionen: { ohneHalteverbot: true }, jetzt });
    expect(r.ok && r.eingabe.fixedPrice).toBe("1430");
  });

  it("Review Astra: ohne ... prüft die Marge an den verbleibenden Kosten, nicht am gesenkten Preis", () => {
    // 1.100 € Selbstkosten, davon 2 × 120 € Halteverbot: ohne Zonen bleiben 860 €, Mindestpreis 1.230 €.
    const knapp: RechnerErgebnis = {
      ...mitHebeln,
      preis: { ...mitHebeln.preis!, festpreis: 1580 },
      kosten: { selbstkosten: 1100, posten: [{ bezeichnung: "Halteverbotszone", menge: 2, einheit: "Stück", satz: 120, betrag: 240 }] },
    };
    expect(angebotsUebernahme({ result: knapp, request: req }, null, { optionen: { ohneHalteverbot: true }, jetzt }).ok).toBe(true); // 1.280 €
    // Ohne Kostenposten fällt nichts weg: 1.280 € < 1.580 € Mindestpreis.
    expect(angebotsUebernahme({ result: { ...knapp, kosten: { selbstkosten: 1100 } }, request: req }, null, { optionen: { ohneHalteverbot: true }, jetzt }).ok).toBe(false);
  });

  it("Endpreis unter der Mindestmarge wird abgelehnt", () => {
    expect(angebotsUebernahme({ result: mitHebeln, request: req }, null, { endpreis: 1200, jetzt })).toEqual({ ok: false, fehler: "Preis liegt unter der Mindestmarge von 30 %." });
  });
});

describe("angebotsUebernahme: Review Codex 2026-10-08", () => {
  const ergebnis: RechnerErgebnis = {
    preis: { festpreis: 1730, selbstkosten: 1100, rundungEur: 10, posten: [{ bezeichnung: "Halteverbotszone", menge: 2, einheit: "Stück", satz: 150, betrag: 300 }] },
    kosten: { selbstkosten: 1100, posten: [] },
    zeiten: {},
    schaetzung: null,
  };
  const req = { von_adresse: "Lerchenstraße 78, 70176 Stuttgart", von_halteverbot: "on", umzugsdatum: "2026-12-01" };
  const jetzt = new Date("2026-10-08T10:00:00Z");

  it("setzt keine Auftragsart: die steuert quotations.service_type (Küche bleibt Küche)", () => {
    const r = angebotsUebernahme({ result: ergebnis, request: req }, null, { jetzt });
    expect(r.ok && r.eingabe.documentDetails).not.toHaveProperty("serviceType");
  });
  it("noch gültige, vorhandene Gültigkeit bleibt (z. B. von Hand verlängert)", () => {
    const r = angebotsUebernahme({ result: ergebnis, request: req }, { notes: null, isVariable: false, validUntil: "2026-11-20" }, { jetzt });
    expect(r.ok && r.eingabe.validUntil).toBe("2026-11-20");
    expect(r.ok && r.eingabe.documentDetails.validUntil).toBe("2026-11-20");
  });
  it("abgelaufene Gültigkeit wird neu gesetzt (7 Tage)", () => {
    const r = angebotsUebernahme({ result: ergebnis, request: req }, { notes: null, isVariable: false, validUntil: "2026-10-01" }, { jetzt });
    expect(r.ok && r.eingabe.validUntil).toBe("2026-10-15");
  });
});
