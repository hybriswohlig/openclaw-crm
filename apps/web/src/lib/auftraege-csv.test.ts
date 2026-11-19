import { describe, expect, it } from "vitest";
import { auftraegeCsv, datumText, namenAus, personZumNamen, teamImportPlan, type AnstehenderAuftrag } from "./auftraege-csv";
import type { EinsatzPerson } from "./einsatz";
import { csvLesen } from "./mitarbeiter-csv";

const person = (id: string, name: string, aktiv = true): EinsatzPerson => ({
  id,
  name,
  kuerzel: "",
  aktiv,
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
});

const P = [
  person("n", "Nurullah Nuri"),
  person("a1", "Ali Kaya"),
  person("a2", "Ali Demir"),
  person("b", "Berisha Erijan"),
  person("e", "Emir"),
  person("alt", "Otto", false),
];

const A: AnstehenderAuftrag[] = [
  { dealId: "d1", tag: "2026-11-22", bisTag: "2026-11-22", von: "08:00", firma: "Kottke", titel: "Meier", strecke: "Calw → Nagold", team: [{ employeeId: "n", role: "lead" }, { employeeId: "b", role: "helper" }] },
  { dealId: "d2", tag: "2026-11-22", bisTag: "2026-11-23", von: null, firma: null, titel: "Schulz; GmbH", strecke: null, team: [] },
  { dealId: "d3", tag: "2026-11-25", bisTag: "2026-11-25", von: null, firma: null, titel: "Otto-Fall", strecke: null, team: [{ employeeId: "alt", role: "lead" }] },
];

const KOPF = "Auftrag-ID (nicht ändern);Datum;Uhrzeit;Firma;Kunde;Strecke;Teamleitung;Helfer (Namen mit Komma)";
const plan = (zeilen: string[]) => teamImportPlan(csvLesen([KOPF, ...zeilen].join("\r\n")), A, P);

describe("Auftrags-Tabelle", () => {
  it("Vorlage: BOM, Semikolon, nach Datum, Leitung und Helfer mit Namen; Rundweg ändert nichts", () => {
    const csv = auftraegeCsv(A, P);
    expect(csv.startsWith("﻿")).toBe(true);
    const z = csv.slice(1).split("\r\n");
    expect(z[0]).toBe(KOPF);
    expect(z[1]).toBe("d1;So 22.11.2026;08:00;Kottke;Meier;Calw → Nagold;Nurullah Nuri;Berisha Erijan");
    expect(z[2]).toBe('d2;So 22.11.–Mo 23.11.2026;;;"Schulz; GmbH";;;');
    const r = teamImportPlan(csvLesen(csv), A, P);
    expect(r.kopfFehlt).toEqual([]);
    expect(r.zeilen.map((x) => x.art)).toEqual(["gleich", "gleich", "gleich"]);
  });

  it("Datum mit Wochentag, mehrtägig", () => {
    expect(datumText("2026-11-22", "2026-11-22")).toBe("So 22.11.2026");
    expect(datumText("2026-12-31", "2027-01-01")).toBe("Do 31.12.–Fr 01.01.2027");
  });

  it("Namen trennen: Komma, Schrägstrich, plus, und; Striche zählen als leer", () => {
    expect(namenAus("Emir, Ali Kaya / Nuri + Berisha und Otto")).toEqual(["Emir", "Ali Kaya", "Nuri", "Berisha", "Otto"]);
    expect(namenAus(" - ")).toEqual([]);
  });

  it("Name: ganz, ein Wort, Anfang; mehrdeutig und unbekannt sind Fehler", () => {
    expect(personZumNamen("nurullah nuri", P)).toEqual({ ok: P[0] });
    expect(personZumNamen("Nuri", P)).toEqual({ ok: P[0] });
    expect(personZumNamen("Beri", P)).toEqual({ ok: P[3] });
    expect(personZumNamen("Ali", P)).toMatchObject({ fehler: expect.stringContaining("Ali Kaya, Ali Demir") });
    expect(personZumNamen("Hans", P)).toMatchObject({ fehler: expect.stringContaining("kennen wir nicht") });
  });

  it("Team setzen: Leitung zuerst, ohne Leitung leitet die erste Person; leere Zellen ändern nichts", () => {
    const r = plan(["d1;;;;;;;", "d2;;;;;;;Emir, Ali Kaya"]);
    expect(r.zeilen[0]).toMatchObject({ art: "gleich" });
    expect(r.zeilen[1]).toMatchObject({
      art: "aendern",
      alt: [],
      neu: ["Emir", "Ali Kaya"],
      team: [{ employeeId: "e", role: "lead" }, { employeeId: "a1", role: "helper" }],
    });
  });

  it("nur die Leitung tauschen ist eine Änderung; „-“ leert das Team", () => {
    const r = plan(["d1;;;;;;Berisha;Nuri", "d3;;;;;;-;"]);
    expect(r.zeilen[0]).toMatchObject({ art: "aendern", neu: ["Berisha Erijan", "Nurullah Nuri"] });
    expect(r.zeilen[1]).toMatchObject({ art: "aendern", alt: ["Otto"], neu: [], team: [] });
  });

  it("Fehler: ohne ID, unbekannte ID, doppelte Zeile, zwei Leitungen, inaktive Person neu", () => {
    const r = plan([";;;;Neu;;Emir;", "zzz;;;;;;Emir;", "d2;;;;;;Emir;", "d2;;;;;;Emir;", "d1;;;;;;Emir, Nuri;Berisha", "d1;;;;;;Otto;"]);
    expect(r.zeilen.map((x) => x.art)).toEqual(["fehler", "fehler", "aendern", "fehler", "fehler", "fehler"]);
    expect(r.zeilen[0]!.fehler[0]).toContain("Ohne Auftrag-ID");
    expect(r.zeilen[1]!.fehler[0]).toContain("gibt es nicht mehr");
    expect(r.zeilen[3]!.fehler[0]).toContain("doppelt");
    expect(r.zeilen[4]!.fehler).toContain("Bei Teamleitung bitte nur einen Namen.");
  });

  it("inaktive Person, die schon im Team ist, darf bleiben", () => {
    const r = plan(["d3;;;;;;Otto;Emir"]);
    expect(r.zeilen[0]).toMatchObject({ art: "aendern", neu: ["Otto", "Emir"] });
  });

  it("doppelt am Tag: neu dazu, aber am selben Tag schon auf einem anderen Auftrag (nach dem Import)", () => {
    // Berisha steht am 22.11. auf d1; d2 (22.–23.11.) will ihn auch.
    const r1 = plan(["d2;;;;;;Berisha;"]);
    expect(r1.zeilen[0]).toMatchObject({ art: "fehler" });
    expect(r1.zeilen[0]!.fehler[0]).toContain("Berisha Erijan ist am selben Tag schon bei Meier");
    // Wechselt er in derselben Datei von d1 nach d2, ist das in Ordnung.
    const r2 = plan(["d1;;;;;;Nuri;", "d2;;;;;;Berisha;"]);
    expect(r2.zeilen.map((x) => x.art)).toEqual(["aendern", "aendern"]);
  });

  it("Kopf fehlt: nichts gelesen", () => {
    const r = teamImportPlan(csvLesen("ID;Name\r\nd1;x"), A, P);
    expect(r.kopfFehlt).toEqual(["Teamleitung", "Helfer"]);
    expect(r.zeilen).toEqual([]);
  });
});
