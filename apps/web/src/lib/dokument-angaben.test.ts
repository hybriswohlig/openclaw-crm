import { describe, expect, it } from "vitest";
import { angabenFehlenText, angabenLink, fehlendeVpsAngaben, jobFehlerText } from "./dokument-angaben";

describe("fehlendeVpsAngaben", () => {
  it("Kundenanschrift und Nachname sind Pflicht", () => {
    expect(fehlendeVpsAngaben({ kunde: { nachname: "Muster", adresse: "Hauptstr. 1, 72218 Wildberg" } })).toEqual([]);
    expect(fehlendeVpsAngaben({ kunde: { nachname: "Muster" } })).toEqual(["auszug"]);
    expect(fehlendeVpsAngaben({ kunde: { nachname: " ", adresse: "—" } })).toEqual(["kundenname", "auszug"]);
    expect(fehlendeVpsAngaben({})).toEqual(["kundenname", "auszug"]);
  });

  it("Text der Sperre", () => {
    expect(angabenFehlenText("KV", ["auszug"])).toBe("KV nicht erstellt: Kundenanschrift fehlt. Angaben ergänzen.");
    expect(angabenFehlenText("RE", ["kundenname", "auszug"])).toBe(
      "Rechnung nicht erstellt: Kundenname fehlt, Kundenanschrift fehlt. Angaben ergänzen."
    );
  });
});

describe("jobFehlerText", () => {
  it("Viktoria: aus dem Skill-Abbruch wird ein verständlicher Satz", () => {
    expect(jobFehlerText("skill exited with code 2. stderr tail: Kundenanschrift fehlt.", "KV")).toEqual({
      text: "KV nicht erstellt: Kundenanschrift fehlt.",
      angabenFehlen: true,
    });
  });

  it("bekannte Felder der Vorlage", () => {
    expect(jobFehlerText("skill exited with code 2. stderr tail: ValueError: Umzug.von.Adresse fehlt", "AB").text).toBe(
      "AB nicht erstellt: Auszugsadresse fehlt."
    );
    expect(jobFehlerText("skill exited with code 2. stderr tail: kunde.nachname fehlt", "RE").text).toBe(
      "Rechnung nicht erstellt: Kundenname fehlt."
    );
  });

  it("Traceback: die letzte Zeile ohne Fehlerklasse zählt", () => {
    const roh = 'skill exited with code 1. stderr tail: Traceback (most recent call last):\n  File "x.py", line 3\nRuntimeError: Vorlage nicht gefunden.';
    expect(jobFehlerText(roh, "KV")).toEqual({ text: "KV nicht erstellt: Vorlage nicht gefunden.", angabenFehlen: false });
  });

  it("ein unbekanntes „… fehlt“ ist eine fehlende Angabe", () => {
    expect(jobFehlerText("skill exited with code 2. stderr tail: Telefon fehlt", "KV")).toEqual({
      text: "KV nicht erstellt: Telefon fehlt.",
      angabenFehlen: true,
    });
  });

  it("abgelaufen, leer und schon übersetzte Texte", () => {
    expect(jobFehlerText("abgelaufen", "KV").text).toBe("KV nicht erstellt: Der Job hat zu lange gedauert. Bitte neu erstellen.");
    expect(jobFehlerText(null, "AB")).toEqual({ text: "AB nicht erstellt.", angabenFehlen: false });
    expect(jobFehlerText("KV nicht erstellt: Kundenanschrift fehlt. Angaben ergänzen.", "KV").angabenFehlen).toBe(true);
    expect(jobFehlerText("Verbindung verloren", "KV").text).toBe("KV nicht erstellt: Verbindung verloren.");
  });

  it("Link in die Akte", () => {
    expect(angabenLink("deal 1")).toBe("/app/leads/deal%201?angaben=1");
  });
});
