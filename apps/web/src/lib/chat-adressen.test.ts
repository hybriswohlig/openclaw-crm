import { describe, expect, it } from "vitest";
import { adressenAusNachrichten, chatAdressenWaehlen, plzOrtAus } from "./chat-adressen";

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
  it("zwei PLZ ohne Hinweis: Reihenfolge wie im Satz", () => {
    expect(adressenAusNachrichten(["PLZ 70372 und 71032"])).toEqual({ von: "70372", nach: "71032" });
  });
  it("eine PLZ ohne Hinweis zählt nicht", () => {
    expect(adressenAusNachrichten(["Ich bin unter 70372 erreichbar"])).toEqual({ von: null, nach: null });
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
