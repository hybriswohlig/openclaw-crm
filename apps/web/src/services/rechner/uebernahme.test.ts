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
