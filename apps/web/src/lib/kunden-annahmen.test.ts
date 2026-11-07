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
  it("Rechner-Hinweise aus einer Übernahme erreichen den Kunden nicht (Anfänge wie im Rechner)", () => {
    const basis = { anfahrtMinuten: 55, etageVon: "3", uebernommenVon: "mensch" as const };
    for (const hinweis of [
      "Mietstation SIXT Sindelfingen (Anfahrt 12 Min, Rückfahrt 14 Min). Schnellschätzung 670 bis 1180 €, übernommen: Obergrenze.",
      "Schnellschätzung 670 bis 1180 €, übernommen: Obergrenze.",
      // Ohne Station und Spanne beginnt der Hinweis mit der ersten Annahme des Rechners.
      "Keine Möbelliste: Umzugsgut aus 3 Zimmern geschätzt (18 bis 26 m³), mit typischen Möbeln für 3 Zimmer.",
      "Keine Möbelliste und keine Größenangabe: gerechnet mit 2 bis 4 Zimmern (typische Haushalte, 18 bis 30 m³).",
      "Etage an der Beladeadresse unbekannt: günstig Erdgeschoss, ungünstig 3. OG ohne Aufzug.",
      "Ohne Fahrzeiten je Station lässt sich die günstigste Station nicht bestimmen; gerechnet mit SIXT und den eingetragenen Fahrzeiten.",
      "Fahrzeiten zur Mietstation unvollständig: Anfahrt 30 Min / 25 km, Rückfahrt 30 Min / 25 km angenommen.",
      "Umzug innerhalb desselben Ortes ohne genaue Adressen: 15 Min und 5 km Strecke angenommen.",
      "Strecke zwischen Belade- und Entladeadresse unbekannt: 30 Min und 20 km angenommen.",
      "Strecke Beladen → Entladen fehlt, mit 0 km gerechnet.",
      "Tragestrecke an der Entladeadresse unbekannt: 20 m angenommen.",
      "Anfahrt und Rückfahrt für Startort Böblingen mit Depotwerten angenommen.",
      "Route für Startort Böblingen fehlt, Anfahrt und Rückfahrt mit 0 gerechnet.",
      "Route unvollständig, Fahrzeit und Kilometer mit 0 gerechnet.",
      "Anhänger Koffer 2 steht an einem anderen Startort als das Zugfahrzeug, Umweg nicht gerechnet.",
      "Volumen auf 25,5 m³ vorgegeben (Gewicht mitskaliert, Tragezeiten aus der Möbelliste)",
      "Volumenvorgabe 25 m³ nicht angewendet: keine Positionen mit Volumen.",
      "Wendeltreppe an der Beladeadresse: vorsichtig gerechnet, als müssten alle Möbel darüber.",
      'Position "Aquarium" ohne Katalogtreffer: 0.5 m³ (Standard der Größenklasse M) und 40 kg (Standard der Größenklasse M) je Stück.',
      "Das gesamte Team fährt im Fahrzeug mit.",
    ]) {
      expect(kundenAnnahmen({ ...basis, hinweis }), hinweis).toMatchObject({ anfahrtMinuten: 55, hinweis: null });
    }
  });
  it("Hinweise von Hand bleiben nach einer Übernahme, auch mit Betrag oder Spanne (Review N3)", () => {
    const basis = { anfahrtMinuten: 55, etageVon: "3", uebernommenVon: "mensch" as const };
    for (const hinweis of [
      "Halteverbotszone 8 bis 12 Uhr beantragt",
      "Halteverbot 8 bis 12 Uhr",
      "Parkgebühr 15 € vor Ort",
      "Halteverbot 150 € eingerechnet.",
      "Preis gilt bei Zugang wie angenommen",
      // Ein Rechner-Wort mitten im Satz macht einen Hinweis von Hand nicht zum Rechner-Hinweis.
      "Transporter kommt von der Mietstation in Sindelfingen",
      "Position des Klaviers vorab klären",
    ]) {
      expect(kundenAnnahmen({ ...basis, hinweis })?.hinweis).toBe(hinweis);
    }
    // Ohne Übernahme ist jeder Hinweis von Hand, auch einer, der wie der Rechner beginnt.
    expect(kundenAnnahmen({ anfahrtMinuten: 55, hinweis: "Mietstation am Bahnhof" })?.hinweis).toBe("Mietstation am Bahnhof");
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
