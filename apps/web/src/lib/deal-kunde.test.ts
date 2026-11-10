import { describe, expect, it } from "vitest";
import {
  KundeFehler,
  adressZeile,
  nameTeile,
  ortAusTeilen,
  pruefeKundeEingabe,
  teileAusOrt,
  vorschlagAdresse,
  vorschlagEmail,
  vorschlagName,
  vorschlagTelefon,
} from "./deal-kunde";

describe("pruefeKundeEingabe", () => {
  it("nimmt nur mitgeschickte Felder und säubert sie", () => {
    expect(
      pruefeKundeEingabe({
        name: "  Viktoria   Muster ",
        telefon: "0171 234 5678",
        email: "Viktoria@Beispiel.de",
        auszug: { strasse: "Hauptstr. 1", plz: "72218", ort: "Wildberg" },
        datum: "2026-11-28",
        quelle: "vorpruefung",
      })
    ).toEqual({
      name: "Viktoria Muster",
      telefon: "0171 234 5678",
      email: "viktoria@beispiel.de",
      auszug: { strasse: "Hauptstr. 1", plz: "72218", ort: "Wildberg" },
      datum: "2026-11-28",
      quelle: "vorpruefung",
    });
    expect(pruefeKundeEingabe({})).toEqual({});
  });

  it("Adresse ohne Straße ist erlaubt, ohne PLZ oder Ort nicht", () => {
    expect(pruefeKundeEingabe({ einzug: { strasse: "", plz: "71032", ort: "Böblingen" } }).einzug).toEqual({
      strasse: "",
      plz: "71032",
      ort: "Böblingen",
    });
    expect(() => pruefeKundeEingabe({ auszug: { strasse: "Hauptstr. 1", plz: "7221", ort: "Wildberg" } })).toThrow(KundeFehler);
    expect(() => pruefeKundeEingabe({ auszug: { strasse: "Hauptstr. 1", plz: "72218", ort: "" } })).toThrow("Ort");
  });

  it("Plan-15-Regel: Telefon-, Kundennummer, IBAN und Signatur sind keine Straße", () => {
    for (const strasse of ["Tel. 0711 123456", "+49 171 2345678", "Kundennummer 4711", "Rechnung 4711", "Auftragsnr. 77", "IBAN DE12 3456", "Mit freundlichen Grüßen"]) {
      expect(() => pruefeKundeEingabe({ auszug: { strasse, plz: "70372", ort: "Stuttgart" } })).toThrow(KundeFehler);
    }
  });

  it("falsche Werte für Name, Telefon, E-Mail, Datum", () => {
    expect(() => pruefeKundeEingabe({ name: "a" })).toThrow("Name");
    expect(() => pruefeKundeEingabe({ name: "0171234567" })).toThrow("Name");
    expect(() => pruefeKundeEingabe({ telefon: "abc" })).toThrow("Telefon");
    expect(() => pruefeKundeEingabe({ email: "kein-at" })).toThrow("E-Mail");
    expect(() => pruefeKundeEingabe({ datum: "2026-02-30" })).toThrow("Datum");
  });
});

describe("Umwandlung", () => {
  it("gespeicherte Ortswerte als Felder", () => {
    expect(teileAusOrt({ line1: "Hauptstr. 1", postcode: "72218", city: "Wildberg" })).toEqual({
      strasse: "Hauptstr. 1",
      plz: "72218",
      ort: "Wildberg",
    });
    // Plan 15: „72218 Wildberg“ ohne Komma landete ganz in line1.
    expect(teileAusOrt({ line1: "72218 Wildberg" })).toEqual({ strasse: "", plz: "72218", ort: "Wildberg" });
    expect(teileAusOrt("Hauptstr. 1, 72218 Wildberg")).toEqual({ strasse: "Hauptstr. 1", plz: "72218", ort: "Wildberg" });
    expect(teileAusOrt({ line1: "" })).toBeNull();
    expect(teileAusOrt(null)).toBeNull();
  });

  it("Felder als Ortswert und Zeile", () => {
    expect(ortAusTeilen({ strasse: "Hauptstr. 1", plz: "72218", ort: "Wildberg" })).toEqual({
      line1: "Hauptstr. 1",
      postcode: "72218",
      city: "Wildberg",
      countryCode: "DE",
    });
    expect(ortAusTeilen({ strasse: "", plz: "72218", ort: "Wildberg" })).toEqual({ postcode: "72218", city: "Wildberg", countryCode: "DE" });
    expect(adressZeile({ strasse: "Hauptstr. 1", plz: "72218", ort: "Wildberg" })).toBe("Hauptstr. 1, 72218 Wildberg");
  });

  it("Namen teilen", () => {
    expect(nameTeile("Maria Anna Schmitt")).toEqual({ firstName: "Maria Anna", lastName: "Schmitt", fullName: "Maria Anna Schmitt" });
    expect(nameTeile("Viktoria")).toEqual({ firstName: "", lastName: "Viktoria", fullName: "Viktoria" });
  });
});

describe("Vorschläge aus dem Chat", () => {
  it("Adresse mit Straße aus der KI", () => {
    expect(vorschlagAdresse("Königstraße 12, 70173 Stuttgart")).toEqual({ strasse: "Königstraße 12", plz: "70173", ort: "Stuttgart" });
    expect(vorschlagAdresse("70372 Stuttgart")).toEqual({ strasse: "", plz: "70372", ort: "Stuttgart" });
  });

  it("Telefon- und Kundennummern werden nie Straße, ohne PLZ und Ort gibt es keinen Vorschlag", () => {
    expect(vorschlagAdresse("Tel. 0711 123456, 70372 Stuttgart")).toEqual({ strasse: "", plz: "70372", ort: "Stuttgart" });
    expect(vorschlagAdresse("Kundennummer 12345")).toBeNull();
    expect(vorschlagAdresse("+49 171 23456 78")).toBeNull();
    expect(vorschlagAdresse("Hauptstr. 1\nMit freundlichen Grüßen\n72218 Wildberg")).toBeNull();
    expect(vorschlagAdresse(null)).toBeNull();
  });

  it("Name, E-Mail und Telefon nur, wenn sie danach aussehen", () => {
    expect(vorschlagName("Viktoria Muster")).toBe("Viktoria Muster");
    expect(vorschlagName("viktoria")).toBeNull();
    expect(vorschlagName("Kunde 0171")).toBeNull();
    expect(vorschlagEmail("V.Muster@Beispiel.de")).toBe("v.muster@beispiel.de");
    expect(vorschlagEmail("abc123@mail.kleinanzeigen.de")).toBeNull();
    expect(vorschlagTelefon("0171 2345678")).toBe("0171 2345678");
    expect(vorschlagTelefon("Ruf mich an")).toBeNull();
  });
});
