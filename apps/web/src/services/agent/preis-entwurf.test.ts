import { describe, expect, it } from "vitest";
import { angebotsPhrase, gewaehlteMarge, leistungenText, ohnePreisPhrase, preisEntwurfText, preisPhrase } from "./preis-entwurf";
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

describe("gewaehlteMarge", () => {
  it("liest margeGewaehltProzent aus den Kalkulationsannahmen des Angebots", () => {
    expect(gewaehlteMarge({ margeGewaehltProzent: 33 })).toBe(33);
  });
  it("fehlend, keine Zahl oder außerhalb 30 bis 60: null", () => {
    expect(gewaehlteMarge(null)).toBeNull();
    expect(gewaehlteMarge({})).toBeNull();
    expect(gewaehlteMarge({ margeGewaehltProzent: "33" })).toBeNull();
    expect(gewaehlteMarge({ margeGewaehltProzent: 25 })).toBeNull();
    expect(gewaehlteMarge({ margeGewaehltProzent: 61 })).toBeNull();
  });
});

describe("angebotsPhrase (Entwurf widerspricht keinem Festpreis im Angebot)", () => {
  const preis = { festpreis: 1170, selbstkosten: 700, rundungEur: 10, margeWirksamProzent: 40, nichtKalkulierbarGrund: null };
  const e = { preis, schaetzung: null };
  const schaetzung = { festpreisVon: 800, festpreisBis: 1170, selbstkostenVon: 480, selbstkostenBis: 700, margeProzent: 40, annahmen: [] };
  const mitMarge = (m: number) => ({ anfahrtMinuten: 55, hinweis: "x", selbstkosten: 700, margeVorschlagProzent: 40, margeGewaehltProzent: m });
  const angebot = (fixedPrice: string | number | null, calculationAssumptions: unknown, isVariable = false) => ({ fixedPrice, isVariable, calculationAssumptions });

  it("1. kein Angebot: Vorschlag des Rechners", () => {
    expect(angebotsPhrase(e, null, false)).toBe("ca. 1.170 €");
  });
  it("2. Festpreis aus der Übernahme mit 30 %: dieser Preis", () => {
    expect(angebotsPhrase(e, angebot("1000", mitMarge(30)), false)).toBe("ca. 1.000 €");
  });
  it("3. Spanne: beide Enden mit der Marge, wenn die Obergrenze dem Festpreis entspricht", () => {
    // 480 ÷ 0,7 = 685,71 → 690; 700 ÷ 0,7 = 1.000
    expect(angebotsPhrase({ preis, schaetzung }, angebot("1000", mitMarge(30)), false)).toBe("ca. 690 bis 1.000 €");
  });
  it("4. Preis von Hand geändert: der Festpreis aus dem Angebot", () => {
    expect(angebotsPhrase(e, angebot("950", mitMarge(30)), false)).toBe("ca. 950 €");
  });
  it("5. Assistent hat die Margenfelder entfernt: der Festpreis aus dem Angebot", () => {
    const nurKunde = { anfahrtMinuten: 55, anfahrtQuelle: "berechnet", etageVon: "3", hinweis: "x" };
    expect(angebotsPhrase(e, angebot("1000", nurKunde), false)).toBe("ca. 1.000 €");
  });
  it("6. Selbstkosten seit der Übernahme gestiegen: der Festpreis aus dem Angebot", () => {
    // 710 ÷ 0,7 = 1.014,29 → 1.020, das Angebot sagt 1.000
    expect(angebotsPhrase({ preis: { ...preis, selbstkosten: 710 }, schaetzung: null }, angebot("1000", mitMarge(30)), false)).toBe("ca. 1.000 €");
  });
  it("7. variables Angebot oder kein Festpreis: Vorschlag des Rechners", () => {
    expect(angebotsPhrase(e, angebot("1000", mitMarge(30), true), false)).toBe("ca. 1.170 €");
    expect(angebotsPhrase(e, angebot(null, mitMarge(30)), false)).toBe("ca. 1.170 €");
    expect(angebotsPhrase(e, angebot("0", mitMarge(30)), false)).toBe("ca. 1.170 €");
    expect(angebotsPhrase(e, angebot("abc", mitMarge(30)), false)).toBe("ca. 1.170 €");
  });
  it("8. Paketoptionen vorhanden: Vorschlag des Rechners", () => {
    expect(angebotsPhrase(e, angebot("1000", mitMarge(30)), true)).toBe("ca. 1.170 €");
  });
  it("9. der Satz aus Fall 3 kommt durch den Preisfilter, jede andere Zahl nicht", () => {
    const phrase = angebotsPhrase({ preis, schaetzung }, angebot("1000", mitMarge(30)), false)!;
    const t = preisEntwurfText({ phrase, leistungen: "Team", frage: null, du: false });
    expect(leaksPriceOrCommitment(t)).toBe(true);
    expect(leaksPriceOrCommitment(ohnePreisPhrase(t, phrase))).toBe(false);
    expect(leaksPriceOrCommitment(ohnePreisPhrase(`${t} Oder 900 €?`, phrase))).toBe(true);
  });
  it("Festpreis als Zahl und mit Nachkommastellen aus der Datenbank", () => {
    expect(angebotsPhrase(e, angebot(1000, mitMarge(30)), false)).toBe("ca. 1.000 €");
    expect(angebotsPhrase(e, angebot("1000.00", mitMarge(30)), false)).toBe("ca. 1.000 €");
  });
  it("alte Kalkulation ohne Selbstkosten und Rundung: der Festpreis aus dem Angebot", () => {
    expect(angebotsPhrase({ preis: { festpreis: 1110 }, schaetzung: null }, angebot("1000", mitMarge(30)), false)).toBe("ca. 1.000 €");
  });
  it("nicht kalkulierbar und kein Festpreis im Angebot: null", () => {
    expect(angebotsPhrase({ preis: { festpreis: null, selbstkosten: 0, rundungEur: 10, nichtKalkulierbarGrund: "x" }, schaetzung: null }, null, false)).toBeNull();
  });
});
