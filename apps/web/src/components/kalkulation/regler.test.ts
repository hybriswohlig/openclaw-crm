import { describe, expect, it } from "vitest";
import type { RechnerErgebnis } from "@/services/rechner/client";
import { reglerZustand } from "./regler";

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

function preisBeiMargeErwartet(k: number, m: number) { return Math.ceil(Math.round(k / (1 - m / 100) * 100) / 100 / 10) * 10; }
