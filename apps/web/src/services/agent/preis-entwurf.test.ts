import { describe, expect, it } from "vitest";
import { duzen, leistungenText, ohnePreisPhrase, preisEntwurfText, preisPhrase } from "./preis-entwurf";
import { leaksPriceOrCommitment } from "./agent-suppress";

describe("preisPhrase", () => {
  it("Spanne aus der Schnellschätzung", () => {
    expect(preisPhrase({ schaetzung: { festpreisVon: 980, festpreisBis: 1110, annahmen: [] } })).toBe("ca. 980 bis 1.110 €");
  });
  it("Festpreis ohne Spanne", () => {
    expect(preisPhrase({ preis: { festpreis: 1110 }, schaetzung: null })).toBe("ca. 1.110 €");
  });
  it("gleiche Grenzen werden ein Betrag", () => {
    expect(preisPhrase({ schaetzung: { festpreisVon: 500, festpreisBis: 500, annahmen: [] } })).toBe("ca. 500 €");
  });
  it("kein Preis: null (dann kein Preis-Entwurf)", () => {
    expect(preisPhrase({ preis: { festpreis: null }, schaetzung: null })).toBeNull();
    expect(preisPhrase({})).toBeNull();
    expect(preisPhrase({ schaetzung: { festpreisVon: 0, festpreisBis: 0, annahmen: [] } })).toBeNull();
  });
});

describe("leistungenText", () => {
  it("Team, Fahrzeug, Abbau/Aufbau und Halteverbot aus der Kalkulation", () => {
    const t = leistungenText(
      {
        team: { groesse: 3 },
        kosten: { selbstkosten: 1, posten: [{ bezeichnung: "Boxer L3H2: Miete", menge: 1, einheit: "Tag", satz: 55, betrag: 55 }] },
        positionen: [
          { name: "Bett mit Matratze", menge: 1, volumenCbm: 1, zerlegt: true },
          { name: "Esstisch", menge: 1, volumenCbm: 1, zerlegt: true },
          { name: "Sofa", menge: 1, volumenCbm: 1, zerlegt: false },
        ],
      },
      { von_halteverbot: "on" }
    );
    expect(t).toBe("Team mit 3 Personen und Transporter, Anfahrt und alle Kilometer, Abbau und Aufbau von Bett mit Matratze und Esstisch, Halteverbotszone");
  });
  it("ohne Details: nur das Grundsätzliche", () => {
    expect(leistungenText({}, {})).toBe("Transporter mit Team, Anfahrt und alle Kilometer");
  });
});

describe("duzen", () => {
  it("erkennt Du im Verlauf, sonst Sie", () => {
    expect(duzen(["Hallo, kannst du mir ein Angebot machen?"])).toBe(true);
    expect(duzen(["Guten Tag, können Sie mir ein Angebot machen?"])).toBe(false);
    expect(duzen(["Danke dir!"])).toBe(true);
  });
});

describe("preisEntwurfText", () => {
  const phrase = "ca. 980 bis 1.110 €";
  it("Sie-Form mit Zusatz und einer Frage", () => {
    const t = preisEntwurfText({ phrase, leistungen: "Team mit 3 Personen", frage: "Welche Möbel stehen im Dachgeschoss?", du: false });
    expect(t).toContain("liegt Ihr Umzug bei ca. 980 bis 1.110 €");
    expect(t).toContain("unverbindliche Orientierung, Festpreis nach Besichtigung oder Fotos");
    expect(t).toContain("Welche Möbel stehen im Dachgeschoss?");
    expect(t).not.toMatch(/[–—]/);
  });
  it("Du-Form", () => {
    expect(preisEntwurfText({ phrase, leistungen: "Team", frage: null, du: true })).toContain("liegt dein Umzug bei");
  });
  it("der Preisfilter lässt genau diesen Satz durch, sonst nichts", () => {
    const t = preisEntwurfText({ phrase, leistungen: "Team", frage: null, du: false });
    expect(leaksPriceOrCommitment(t)).toBe(true);
    expect(leaksPriceOrCommitment(ohnePreisPhrase(t, phrase))).toBe(false);
    expect(leaksPriceOrCommitment(ohnePreisPhrase(`${t} Oder 900 €?`, phrase))).toBe(true);
    expect(ohnePreisPhrase(t, null)).toBe(t);
  });
});
