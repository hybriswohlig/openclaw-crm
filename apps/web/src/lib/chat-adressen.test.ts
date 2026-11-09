import { describe, expect, it } from "vitest";
import { adressenAusNachrichten, chatAdressenWaehlen, kartonsAusKi, kartonsAusNachrichten, plzOrtAus } from "./chat-adressen";

describe("plzOrtAus", () => {
  it("nimmt PLZ und Ort aus einer vollen Adresse", () => {
    expect(plzOrtAus("Hauptstraße 5, 70372 Stuttgart")).toBe("70372 Stuttgart");
    expect(plzOrtAus("Am Bach 3 71032 Böblingen")).toBe("71032 Böblingen");
    expect(plzOrtAus("70191 Bad Cannstatt")).toBe("70191 Bad Cannstatt");
    expect(plzOrtAus("70771 Leinfelden-Echterdingen, 2. OG")).toBe("70771 Leinfelden-Echterdingen");
  });
  it("PLZ allein bleibt PLZ, ohne PLZ null", () => {
    expect(plzOrtAus("70372")).toBe("70372");
    expect(plzOrtAus("Stuttgart")).toBeNull();
    expect(plzOrtAus("")).toBeNull();
    expect(plzOrtAus(null)).toBeNull();
  });
  it("Beträge, Maße und Telefonnummern sind keine PLZ", () => {
    expect(plzOrtAus("Budget 12000 €")).toBeNull();
    expect(plzOrtAus("Fläche 10000 qm")).toBeNull();
    expect(plzOrtAus("Tel 0171 1234567")).toBeNull();
    expect(plzOrtAus("Tel 01711234567")).toBeNull();
    expect(plzOrtAus("00999 Nirgendwo")).toBeNull();
  });
});

describe("adressenAusNachrichten", () => {
  it("Viktoria: von … nach … mit zwei PLZ", () => {
    expect(adressenAusNachrichten(["Hallo, wir ziehen von 70372 Stuttgart nach 71032 Böblingen um."])).toEqual({
      von: "70372 Stuttgart",
      nach: "71032 Böblingen",
    });
  });
  it("zwei PLZ in getrennten Nachrichten mit Hinweiswörtern", () => {
    expect(
      adressenAusNachrichten(["Wir wohnen aktuell in 70372 Stuttgart.", "Die neue Wohnung ist in 73728 Esslingen"])
    ).toEqual({ von: "70372 Stuttgart", nach: "73728 Esslingen" });
  });
  it("zwei PLZ mit Ort ohne Hinweis: Reihenfolge wie im Satz; ohne Ort nie", () => {
    expect(adressenAusNachrichten(["70372 Stuttgart und 71032 Böblingen"])).toEqual({ von: "70372 Stuttgart", nach: "71032 Böblingen" });
    expect(adressenAusNachrichten(["PLZ 70372 und 71032"])).toEqual({ von: null, nach: null });
  });
  it("eine PLZ ohne Hinweis zählt nicht", () => {
    expect(adressenAusNachrichten(["Ich bin unter 70372 erreichbar"])).toEqual({ von: null, nach: null });
  });
  it("Review I1: Telefon, Vorwahl, Kundennummer und Signatur werden nie Adressen", () => {
    expect(adressenAusNachrichten(["Abholung in 71032 Böblingen, Tel. 07031 123456"])).toEqual({ von: "71032 Böblingen", nach: null });
    expect(
      adressenAusNachrichten(["Wir ziehen von 71032 Böblingen nach 70372 Stuttgart.", "Viele Grüße\nMax Muster\nTel.: 07031 / 12345"])
    ).toEqual({ von: "71032 Böblingen", nach: "70372 Stuttgart" });
    expect(adressenAusNachrichten(["Kundennummer 45678, Auszug 70372 Stuttgart"])).toEqual({ von: "70372 Stuttgart", nach: null });
    expect(adressenAusNachrichten(["Mobil: 01711 23456", "IBAN DE89 3704 0044 0532 0130 00", "Fax 07031 12345 Böblingen"])).toEqual({ von: null, nach: null });
    expect(adressenAusNachrichten(["Hallo\n--\nMuster GmbH, 70173 Stuttgart, 71032 Böblingen"])).toEqual({ von: null, nach: null });
  });
  it("Review I1: eine spätere Nachricht ohne Hinweiswort überschreibt nichts", () => {
    expect(adressenAusNachrichten(["von 70372 Stuttgart nach 71032 Böblingen", "Wir sind 80331 München und 10115 Berlin"])).toEqual({
      von: "70372 Stuttgart",
      nach: "71032 Böblingen",
    });
  });
  it("eine spätere Nachricht korrigiert", () => {
    expect(
      adressenAusNachrichten(["von 70372 Stuttgart nach 71032 Böblingen", "Korrektur: wir ziehen nach 71034 Böblingen"])
    ).toEqual({ von: "70372 Stuttgart", nach: "71034 Böblingen" });
  });
  it("ignoriert Preise und leere Texte", () => {
    expect(adressenAusNachrichten(["", "Was kostet das? 12000 € ist zu viel"])).toEqual({ von: null, nach: null });
  });
});

describe("chatAdressenWaehlen", () => {
  const ki = { von: "Hauptstr. 1, 70372 Stuttgart", nach: null };
  const erkennung = { von: "70000 Falsch", nach: "71032 Böblingen" };
  it("Vorrang Lead vor KI vor Erkennung", () => {
    expect(chatAdressenWaehlen({ von: null, nach: null }, ki, erkennung)).toEqual({
      von: "70372 Stuttgart",
      nach: "71032 Böblingen",
      quelleVon: "ki",
      quelleNach: "erkennung",
    });
    expect(chatAdressenWaehlen({ von: "Lead 1, 70173 Stuttgart", nach: null }, ki, erkennung)).toEqual({
      von: null,
      nach: "71032 Böblingen",
      quelleVon: null,
      quelleNach: "erkennung",
    });
  });
  it("ohne Angaben alles null", () => {
    expect(chatAdressenWaehlen({ von: null, nach: null }, null, null)).toEqual({ von: null, nach: null, quelleVon: null, quelleNach: null });
  });
});

describe("kartonsAusNachrichten (Bauteil 13)", () => {
  it("Spanne: der obere Wert", () => {
    expect(kartonsAusNachrichten(["Wir haben so 10 bis 15 Umzugskartons"])).toBe(15);
    expect(kartonsAusNachrichten(["ca. 10-15 Kartons"])).toBe(15);
  });
  it("einzelne Zahl, neueste Nennung gewinnt; Kisten und Boxen zählen nicht", () => {
    expect(kartonsAusNachrichten(["20 Kartons", "doch eher 25 Umzugskartons"])).toBe(25);
    expect(kartonsAusNachrichten(["5 Kisten Wasser und 3 Boxen (Lautsprecher)"])).toBeNull();
  });
  it("ohne Nennung null, Preise zählen nicht", () => {
    expect(kartonsAusNachrichten(["Was kostet ein Karton? 3 €"])).toBeNull();
    expect(kartonsAusNachrichten([])).toBeNull();
  });
  it("KI-Wert", () => {
    expect(kartonsAusKi(15)).toBe(15);
    expect(kartonsAusKi("12")).toBe(12);
    expect(kartonsAusKi(null)).toBeNull();
    expect(kartonsAusKi(0)).toBeNull();
  });
});
