import { describe, expect, it } from "vitest";
import type { RechnerErgebnis } from "@/services/rechner/client";
import { prozentText, punkteText, reglerTexte, reglerZustand } from "./regler";

const teil = (x: unknown) => x as RechnerErgebnis;

const e = teil({
  kosten: { selbstkosten: 700 },
  preis: { festpreis: 1170, selbstkosten: 700, rundungEur: 10, listenpreis: 1080, margeWirksamProzent: 40,
    margeVorschlag: { prozent: 40, gruende: [{ text: "Basis Kottke", punkte: 40 }] }, nichtKalkulierbarGrund: null },
});

describe("reglerZustand", () => {
  it("startet auf dem Vorschlag und rechnet live", () => {
    const z = reglerZustand(e, null);
    expect(z).toMatchObject({ verfuegbar: true, startMarge: 40, veraltet: false, festpreis: 1170, margeEur: 470, listenpreis: 1080 });
    expect(reglerZustand(e, 30).festpreis).toBe(1000);
  });
  it("klemmt Reglerwerte auf 30 bis 60", () => {
    expect(reglerZustand(e, 10).festpreis).toBe(1000);
    expect(reglerZustand(e, 90).festpreis).toBe(preisBeiMargeErwartet(700, 60));
  });
  it("Spanne: beide Enden mit derselben Marge", () => {
    const s = teil({ ...e, schaetzung: { festpreisVon: 800, festpreisBis: 1170, selbstkostenVon: 480, selbstkostenBis: 700, margeProzent: 40, annahmen: [] } });
    const z = reglerZustand(s, 30);
    expect(z.festpreisVon).toBe(690); // 480 ÷ 0,7 = 685,71 → 690
    expect(z.festpreis).toBe(1000);
  });
  it("altes Ergebnis ohne Vorschlag: veraltet, Start 30, kein Live-Preis", () => {
    const alt = teil({ kosten: { selbstkosten: 700 }, preis: { festpreis: 1000, nichtKalkulierbarGrund: null } });
    expect(reglerZustand(alt, null)).toMatchObject({ verfuegbar: false, veraltet: true, startMarge: 30 });
  });
  it("nicht kalkulierbar oder kein Ergebnis: nicht verfügbar", () => {
    expect(reglerZustand(null, null).verfuegbar).toBe(false);
    expect(reglerZustand(teil({ preis: { festpreis: null, nichtKalkulierbarGrund: "x" } }), null).verfuegbar).toBe(false);
  });
});

describe("reglerTexte (Karte zeigt den Reglerpreis groß)", () => {
  it("Festpreis: Preis wie die Überschrift, gewählte Marge mit Vorschlag, Marge in € und nach Rundung", () => {
    // 700 ÷ 0,65 = 1.076,92 → 1.080; Marge 380 € = 35,2 % vom Preis
    expect(reglerTexte(reglerZustand(e, 35))).toEqual({
      preis: "1.080 €",
      marge: "Marge 35 % (Vorschlag 40 %)",
      margeDetail: "380 € Marge, nach Rundung 35,2 %",
      aria: "35 % Marge",
    });
  });
  it("ohne Reglerwahl: der Vorschlag", () => {
    expect(reglerTexte(reglerZustand(e, null))).toMatchObject({ preis: "1.170 €", marge: "Marge 40 % (Vorschlag 40 %)", aria: "40 % Marge" });
  });
  it("30 %: genau der Preis, den der Knopf übernimmt", () => {
    expect(reglerTexte(reglerZustand(e, 30))).toMatchObject({ preis: "1.000 €", margeDetail: "300 € Marge, nach Rundung 30 %" });
  });
  it("Spanne: beide Enden mit der gewählten Marge", () => {
    const s = teil({ ...e, schaetzung: { festpreisVon: 800, festpreisBis: 1170, selbstkostenVon: 480, selbstkostenBis: 700, margeProzent: 40, annahmen: [] } });
    expect(reglerTexte(reglerZustand(s, 30))?.preis).toBe("690 € bis 1.000 €");
  });
  it("Regler nicht verfügbar: null (Überschrift bleibt wie bisher)", () => {
    expect(reglerTexte(reglerZustand(null, null))).toBeNull();
    expect(reglerTexte(reglerZustand(teil({ kosten: { selbstkosten: 700 }, preis: { festpreis: 1000, nichtKalkulierbarGrund: null } }), null))).toBeNull();
  });
});

describe("prozentText und punkteText", () => {
  it("deutsches Dezimalkomma, kein Punkt", () => {
    expect(prozentText(35)).toBe("35 %");
    expect(prozentText(35.25)).toBe("35,3 %");
    expect(prozentText(42.5)).toBe("42,5 %");
  });
  it("Punkte mit Vorzeichen, Minus als U+2212", () => {
    expect(punkteText(5)).toBe("+5");
    expect(punkteText(-3)).toBe("\u22123");
    expect(punkteText(0)).toBe("0");
    expect(punkteText(2.5)).toBe("+2,5");
    expect(punkteText(-1.5)).toBe("\u22121,5");
  });
});

function preisBeiMargeErwartet(k: number, m: number) { return Math.ceil(Math.round(k / (1 - m / 100) * 100) / 100 / 10) * 10; }
