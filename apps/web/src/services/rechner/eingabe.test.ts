import { describe, expect, it } from "vitest";
import { eingabeHash, rechnerAnfrageAus, type LeadDaten } from "./eingabe";

const leer: LeadDaten = {
  von: null, nach: null, etageVon: null, etageNach: null, zugangVon: null, zugangNach: null,
  umzugsdatum: null, wohnflaecheQm: null, zimmer: null, tragestreckeVonM: null, tragestreckeNachM: null,
  halteverbot: false, packService: false, kartons: null, inventar: [],
};

describe("rechnerAnfrageAus", () => {
  it("frischer Lead ohne Angaben: keine Etage, keine Adresse, nichts erfunden", () => {
    const a = rechnerAnfrageAus(leer);
    expect(a).not.toHaveProperty("von_etage");
    expect(a).not.toHaveProperty("von_adresse");
    expect(a.nach_vorhanden).toBeUndefined();
  });
  it("Zugang: Aufzug → klein, Treppe → keiner, Erdgeschoss → Etage 0", () => {
    const a = rechnerAnfrageAus({ ...leer, von: "Böblingen", nach: "Sindelfingen", zugangVon: "Aufzug", etageVon: 4, zugangNach: "Erdgeschoss" });
    expect(a).toMatchObject({ von_aufzug: "klein", von_etage: "4", nach_etage: "0", nach_aufzug: "keiner", nach_vorhanden: "on" });
  });
  it("eine eingetragene Etage schlägt die Etage aus der Zugangsart", () => {
    expect(rechnerAnfrageAus({ ...leer, zugangVon: "Erdgeschoss", etageVon: 2 })).toMatchObject({ von_etage: "2" });
  });
  it("Einfamilienhaus: Etage 0, kein Aufzug", () => {
    expect(rechnerAnfrageAus({ ...leer, zugangVon: "Nicht nötig (Einfamilienhaus)" })).toMatchObject({ von_etage: "0", von_aufzug: "keiner" });
  });
  it("unbekannte Zugangsart setzt nichts", () => {
    const a = rechnerAnfrageAus({ ...leer, zugangVon: "irgendwas" });
    expect(a).not.toHaveProperty("von_aufzug");
    expect(a).not.toHaveProperty("von_etage");
  });
  it("Inventar: bleibt-da-Zeilen fallen weg, der Rest geht als Freitext", () => {
    const a = rechnerAnfrageAus({ ...leer, inventar: [
      { name: "Sofa", menge: 1, groessenklasse: "gross", volumenCbm: 1.5, mitnehmen: true },
      { name: "Einbauküche", menge: 1, groessenklasse: null, volumenCbm: null, mitnehmen: false },
    ] });
    expect(a.positionen_freitext).toEqual([{ name: "Sofa", menge: 1, groessenklasse: "gross", volumenCbm: 1.5 }]);
  });
  it("unbekannte Größenklasse wird nicht mitgeschickt (der Rechner würde sie ablehnen)", () => {
    const a = rechnerAnfrageAus({ ...leer, inventar: [{ name: "Kiste", menge: 2, groessenklasse: "riesig", volumenCbm: null, mitnehmen: true }] });
    expect(a.positionen_freitext).toEqual([{ name: "Kiste", menge: 2 }]);
  });
  it("Packservice mit Kartonzahl bucht den Einpackservice", () => {
    expect(rechnerAnfrageAus({ ...leer, packService: true, kartons: 40 })).toMatchObject({ einpack_kartons: "40" });
  });
  it("Wohnfläche, Zimmer, Datum und Tragestrecken werden übergeben", () => {
    expect(rechnerAnfrageAus({ ...leer, wohnflaecheQm: 70, zimmer: 3, umzugsdatum: "2026-10-14", tragestreckeVonM: 30 }))
      .toMatchObject({ wohnflaeche_qm: "70", zimmer: "3", umzugsdatum: "2026-10-14", von_tragestrecke: "30" });
  });
  it("Hash ist unabhängig von der Schlüsselreihenfolge und ändert sich mit der Eingabe", () => {
    expect(eingabeHash({ a: "1", b: "2" })).toBe(eingabeHash({ b: "2", a: "1" }));
    expect(eingabeHash({ a: "1" })).not.toBe(eingabeHash({ a: "2" }));
  });
  it("'innerhalb X' ohne Zieladresse: Zielseite aktiv, der Rechner nimmt denselben Ort (Review Sol)", () => {
    expect(rechnerAnfrageAus({ ...leer, von: "innerhalb Böblingen" })).toMatchObject({ nach_vorhanden: "on" });
  });
  it("Zieletage oder Zielzugang ohne Zieladresse: Zielseite aktiv, Angaben gehen mit (Review Sol)", () => {
    expect(rechnerAnfrageAus({ ...leer, von: "Böblingen", etageNach: 2, zugangNach: "Treppe" }))
      .toMatchObject({ nach_vorhanden: "on", nach_etage: "2", nach_aufzug: "keiner" });
  });
  it("Einpackservice ohne Kartonzahl wird markiert statt still weggelassen (Review Sol)", () => {
    const a = rechnerAnfrageAus({ ...leer, packService: true, kartons: null });
    expect(a).not.toHaveProperty("einpack_kartons");
    expect(a.einpack_ohne_anzahl).toBe("on");
  });
});
