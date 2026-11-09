import { describe, expect, it } from "vitest";
import { AdressFehler, pruefeAdressEingabe } from "./kalkulation-adresse";

describe("pruefeAdressEingabe (Plan 15, Bauteil 2)", () => {
  it("nimmt Seite, Adresse, Quelle und Version", () => {
    expect(pruefeAdressEingabe({ seite: "beladen", adresse: "  Hauptstr. 5,  70372 Stuttgart ", quelle: "chat", version: 3 })).toEqual({
      seite: "beladen",
      adresse: "Hauptstr. 5, 70372 Stuttgart",
      quelle: "chat",
      version: 3,
    });
    expect(pruefeAdressEingabe({ seite: "entladen", adresse: "71032 Böblingen" })).toMatchObject({ quelle: "kalkulation", version: null });
  });
  it("lehnt Unsinn ab", () => {
    expect(() => pruefeAdressEingabe({ seite: "x", adresse: "70372 Stuttgart" })).toThrow(AdressFehler);
    expect(() => pruefeAdressEingabe({ seite: "beladen", adresse: "" })).toThrow(/Adresse/);
    expect(() => pruefeAdressEingabe({ seite: "beladen", adresse: "12 3" })).toThrow(/PLZ oder Ort/);
    expect(() => pruefeAdressEingabe(null)).toThrow(AdressFehler);
  });
});
