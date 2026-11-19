import { describe, expect, it } from "vitest";
import type { EinsatzPerson } from "./einsatz";
import { csvLesen, importPlan, telefonFuerExcel, telefonReparieren, vorlageCsv } from "./mitarbeiter-csv";

const person = (o: Partial<EinsatzPerson> & { id: string; name: string }): EinsatzPerson => ({
  kuerzel: "XX",
  aktiv: true,
  plz: null,
  wohnort: null,
  strasse: null,
  fuehrerschein: null,
  kannSprinter: false,
  eigenerPkw: false,
  satzFahrtCent: 1500,
  satzArbeitCent: 2000,
  telefon: null,
  sprache: "de",
  ...o,
});
const leute = [
  person({ id: "e1", name: "Berisha Erijan" }),
  person({ id: "e2", name: "Nuri", telefon: "0151 1111111", wohnort: "Nagold", plz: "72202" }),
  person({ id: "e3", name: "Ali" }),
  person({ id: "e4", name: "Ali" }),
  person({ id: "e5", name: "Weg", aktiv: false }),
];
const kopf = "ID (nicht ändern);Name;Telefon;Sprache (de/en/tr/ar/pl/uk/ru);Straße (optional);PLZ;Ort;Führerschein (keiner/B/BE/C1/C1E/C/CE);Darf Sprinter fahren (ja/nein);Eigenes Auto (ja/nein)";
const plan = (zeilen: string[]) => importPlan(csvLesen([kopf, ...zeilen].join("\r\n")), leute);

describe("Mitarbeiter-CSV", () => {
  it("Vorlage: BOM, Semikolon, nur aktive, vorhandene Werte drin, liest sich selbst wieder ohne Änderung", () => {
    const csv = vorlageCsv(leute);
    expect(csv.startsWith("﻿ID (nicht ändern);Name;")).toBe(true);
    expect(csv).toContain("e2;Nuri;0151 1111111;de;;72202;Nagold;;nein;nein");
    expect(csv).not.toContain("Weg");
    const p = importPlan(csvLesen(csv), leute);
    expect(p.kopfFehlt).toEqual([]);
    expect(p.zeilen.every((z) => z.art === "gleich")).toBe(true);
  });

  it("CSV lesen: Komma oder Semikolon, Anführungszeichen, Zeilenumbruch in Zelle, leere Zeilen", () => {
    expect(csvLesen('a,b\r\n"x, y","z ""q"""\n\n')).toEqual([["a", "b"], ["x, y", 'z "q"']]);
    expect(csvLesen('a;b\n"zwei\nZeilen";c')).toEqual([["a", "b"], ["zwei\nZeilen", "c"]]);
  });

  it("leere Zellen ändern nichts; Werte werden erkannt und nur echte Änderungen gezählt", () => {
    const p = plan([
      "e1;;015112345678;Türkisch;Hauptstr. 5;72202;Nagold;Klasse b;x;nein",
      "e2;Nuri;+49 151 1111111;;;;;;;",
    ]);
    const [a, b] = p.zeilen;
    expect(a!.art).toBe("aendern");
    expect(a!.eingabe).toEqual({ telefon: "015112345678", sprache: "tr", strasse: "Hauptstr. 5", plz: "72202", wohnort: "Nagold", fuehrerschein: "B", kannSprinter: true });
    expect(a!.aenderungen.map((x) => x.feld)).toEqual(["telefon", "sprache", "strasse", "plz", "wohnort", "fuehrerschein", "kannSprinter"]);
    expect(b!.art).toBe("gleich");
  });

  it("Excel-Schäden: PLZ ohne führende Null, Nummer ohne Null oder Plus, wissenschaftliche Zahl", () => {
    expect(telefonReparieren("15112345678")).toBe("015112345678");
    expect(telefonReparieren("4915112345678")).toBe("+4915112345678");
    expect(telefonReparieren("'0151 123")).toBe("0151 123");
    // Vorlage: Nummern mit Leerzeichen, damit Excel keine Zahl daraus macht; liest sich als dieselbe Nummer.
    expect(telefonFuerExcel("+4917670722968")).toBe("+49 176 70722968");
    expect(telefonFuerExcel("0151 1111111")).toBe("0151 1111111");
    const mitPlus = [person({ id: "p1", name: "Plus", telefon: "+4917670722968" })];
    expect(importPlan(csvLesen(vorlageCsv(mitPlus)), mitPlus).zeilen[0]!.art).toBe("gleich");
    const p = plan(["e1;;4,91511E+12;;;1067;Dresden;;;"]);
    expect(p.zeilen[0]!.art).toBe("fehler");
    expect(p.zeilen[0]!.fehler[0]!.text).toMatch(/Excel/);
    expect(plan(["e1;;;;;1067;Dresden;;;"]).zeilen[0]!.eingabe.plz).toBe("01067");
  });

  it("Fehler: unbekannte ID, Unsinn bei ja/nein, Sprache, Führerschein, PLZ; doppelte Nummer (auch in der Datei)", () => {
    const p = plan([
      "zz;Fremd;;;;;;;;",
      "e1;;;Klingonisch;;123;;Z;vielleicht;",
      "e3;;0151 1111111;;;;;;;",
      ";Neu Eins;0170 5555555;;;;;;;",
      ";Neu Zwei;0170 5555555;;;;;;;",
    ]);
    expect(p.zeilen.map((z) => z.art)).toEqual(["fehler", "fehler", "fehler", "neu", "fehler"]);
    expect(p.zeilen[1]!.fehler.map((f) => f.feld)).toEqual(["Sprache", "Führerschein", "Sprinter", ""]);
    expect(p.zeilen[2]!.fehler[0]!.text).toMatch(/schon jemand/);
  });

  it("Zuordnung ohne ID: eindeutiger Name trifft, doppelter Name wird neu angelegt; ohne Name und ID fehlt der Kopf", () => {
    const p = plan([";berisha erijan;;;;;Calw;;;", ";Ali;;;;;;;;"]);
    expect(p.zeilen[0]).toMatchObject({ id: "e1", art: "aendern" });
    expect(p.zeilen[1]).toMatchObject({ id: null, art: "neu" });
    expect(importPlan(csvLesen("Telefon;Ort\n0151 1;X"), leute).kopfFehlt).toEqual(["Name oder ID"]);
  });

  it("Formeln aus Excel werden in der Vorlage entschärft", () => {
    const csv = vorlageCsv([person({ id: "e9", name: "=HYPERLINK(1)" })]);
    expect(csv).toContain("e9;'=HYPERLINK(1);");
  });
});
