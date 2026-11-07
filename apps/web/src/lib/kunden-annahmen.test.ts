import { describe, expect, it } from "vitest";
import { annahmenZusammenfuehren, kundenAnnahmen } from "./kunden-annahmen";

describe("kundenAnnahmen", () => {
  it("entfernt interne Kalkulationsdaten, behält Kundenfelder", () => {
    const r = kundenAnnahmen({
      anfahrtMinuten: 55, anfahrtQuelle: "berechnet", etageVon: "3", etageBis: "0", zugangVon: "a", zugangBis: "b",
      inventarPositionen: 3, inventarVolumenCbm: 18.4, hinweis: "x",
      selbstkosten: 700, margeVorschlagProzent: 40, margeGruende: [{ text: "t", punkte: 1 }], margeGewaehltProzent: 30,
      margeTatsaechlichProzent: 30, uebernommenVon: "mensch", uebernommenAm: "2026-09-28T10:00:00.000Z",
    });
    expect(Object.keys(r!).sort()).toEqual(
      ["anfahrtMinuten", "anfahrtQuelle", "etageBis", "etageVon", "hinweis", "inventarPositionen", "inventarVolumenCbm", "zugangBis", "zugangVon"]
    );
    expect(r).toMatchObject({ anfahrtMinuten: 55, hinweis: "x" });
  });
  it("Rechner-Hinweise mit Beträgen oder Spannen aus einer Übernahme erreichen den Kunden nicht", () => {
    const basis = { anfahrtMinuten: 55, etageVon: "3", uebernommenVon: "mensch" as const };
    for (const hinweis of [
      "Mietstation SIXT Sindelfingen (Anfahrt 12 Min, Rückfahrt 14 Min). Schnellschätzung 670 bis 1180 €, übernommen: Obergrenze.",
      "Schnellschätzung 670 bis 1180 €, übernommen: Obergrenze.",
      "Keine Möbelliste: Umzugsgut aus 3 Zimmern geschätzt (18 bis 26 m³).",
      "Halteverbot 150 € eingerechnet.",
    ]) {
      expect(kundenAnnahmen({ ...basis, hinweis })).toMatchObject({ anfahrtMinuten: 55, hinweis: null });
    }
    // Ein Hinweis von Hand bleibt, auch nach einer Übernahme.
    expect(kundenAnnahmen({ ...basis, hinweis: "Preis gilt bei Zugang wie angenommen" })?.hinweis).toBe(
      "Preis gilt bei Zugang wie angenommen"
    );
    // Ohne Übernahme ist der Hinweis von Hand, auch mit Betrag.
    expect(kundenAnnahmen({ anfahrtMinuten: 55, hinweis: "Halteverbot 150 € eingerechnet." })?.hinweis).toBe("Halteverbot 150 € eingerechnet.");
  });
  it("ohne sichtbare Angabe null (der Abschnitt entfällt)", () => {
    expect(kundenAnnahmen({ hinweis: "Schnellschätzung 670 bis 1180 €, übernommen: Obergrenze.", uebernommenVon: "agent", selbstkosten: 700 })).toBeNull();
    expect(kundenAnnahmen({ anfahrtQuelle: "manuell", hinweis: "", selbstkosten: 700 })).toBeNull();
    expect(kundenAnnahmen({ inventarPositionen: 0 })).toMatchObject({ inventarPositionen: 0 });
  });
  it("null und undefined bleiben null", () => {
    expect(kundenAnnahmen(null)).toBeNull();
    expect(kundenAnnahmen(undefined)).toBeNull();
  });
});

describe("annahmenZusammenfuehren (Speichern im Angebot)", () => {
  const uebernahme = {
    anfahrtMinuten: 55, anfahrtQuelle: "berechnet" as const, etageVon: "3", etageBis: "0", zugangVon: "a", zugangBis: "b",
    inventarPositionen: 3, inventarVolumenCbm: 18.4, hinweis: "Mietstation X",
    selbstkosten: 700, margeVorschlagProzent: 40, margeGruende: [{ text: "Basis Kottke", punkte: 40 }], margeGewaehltProzent: 30,
    margeTatsaechlichProzent: 30, uebernommenVon: "mensch" as const, uebernommenAm: "2026-09-28T10:00:00.000Z",
  };

  it("nur Kundenfelder (Status-Link-Assistent): interne Felder der Übernahme bleiben erhalten", () => {
    const r = annahmenZusammenfuehren(uebernahme, { anfahrtMinuten: 60, anfahrtQuelle: "manuell", etageVon: "4", hinweis: "neu" });
    expect(r).toMatchObject({
      selbstkosten: 700, margeVorschlagProzent: 40, margeGruende: [{ text: "Basis Kottke", punkte: 40 }], margeGewaehltProzent: 30,
      margeTatsaechlichProzent: 30, uebernommenVon: "mensch", uebernommenAm: "2026-09-28T10:00:00.000Z",
    });
  });
  it("Kundenfelder kommen nur aus den neuen Werten: ersetzt, fehlende nicht aus dem alten Stand übernommen", () => {
    const r = annahmenZusammenfuehren(uebernahme, { anfahrtMinuten: 60, anfahrtQuelle: "manuell", etageVon: "4", hinweis: "neu" })!;
    expect(r).toMatchObject({ anfahrtMinuten: 60, anfahrtQuelle: "manuell", etageVon: "4", hinweis: "neu" });
    expect(r.etageBis).toBeUndefined();
    expect(r.zugangVon).toBeUndefined();
    expect(r.inventarVolumenCbm).toBeUndefined();
  });
  it("neue interne Werte gewinnen (neue Übernahme schreibt alle Felder)", () => {
    const neu = { ...uebernahme, selbstkosten: 710, margeGewaehltProzent: 35, margeGruende: null, uebernommenVon: "agent" as const, uebernommenAm: "2026-09-29T08:00:00.000Z" };
    expect(annahmenZusammenfuehren(uebernahme, neu)).toEqual(neu);
  });
  it("kein bisheriger Stand: die neuen Werte unverändert", () => {
    const neu = { anfahrtMinuten: 60, hinweis: "x" };
    expect(annahmenZusammenfuehren(null, neu)).toEqual(neu);
    expect(annahmenZusammenfuehren(undefined, neu)).toEqual(neu);
  });
  it("null bleibt null (Annahmen bewusst geleert, wie bisher)", () => {
    expect(annahmenZusammenfuehren(uebernahme, null)).toBeNull();
  });
});
