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
