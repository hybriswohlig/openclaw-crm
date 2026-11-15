import { describe, expect, it } from "vitest";
import { preisBeiMarge } from "@/services/rechner/marge";
import { margeAusPreis, preisGrenzen } from "./preis-eingabe-logik";

const m = { selbstkostenEur: 1533, rundungEur: 10 };

describe("margeAusPreis", () => {
  it("rechnet aus dem Preis die Marge, die der Rechner genau zu diesem Preis rundet", () => {
    const r = margeAusPreis(m, "2.450");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.preisCent).toBe(245000);
    expect(preisBeiMarge(1533, r.prozent, 10)).toBe(2450);
    expect(r.prozent).toBeGreaterThan(37);
    expect(r.prozent).toBeLessThan(38);
    expect(Math.round(r.prozent * 100)).toBe(r.prozent * 100);
    expect(r.gewinnCent).toBe(245000 - 153300);
    expect(r.aufgerundet).toBe(false);
  });

  it("rundet einen krummen Preis wie der Rechner auf und sagt das", () => {
    const r = margeAusPreis(m, "2.444,50 €");
    expect(r.ok && r.preisCent).toBe(245000);
    expect(r.ok && r.aufgerundet).toBe(true);
  });

  it("liefert die größte Marge zu diesem Preis (ein Hundertstel mehr ergäbe den nächsten Preis)", () => {
    const r = margeAusPreis(m, "2450");
    if (!r.ok) throw new Error(r.meldung);
    expect(preisBeiMarge(1533, Math.round((r.prozent + 0.01) * 100) / 100, 10)).toBeGreaterThan(2450);
  });

  it("lehnt Preise außerhalb 30 bis 60 % mit der Grenze ab", () => {
    const g = preisGrenzen(m);
    expect(g.minCent).toBe(preisBeiMarge(1533, 30, 10) * 100);
    expect(g.maxCent).toBe(preisBeiMarge(1533, 60, 10) * 100);
    const zuTief = margeAusPreis(m, "1.800");
    expect(zuTief.ok).toBe(false);
    if (!zuTief.ok) expect(zuTief.meldung).toMatch(/Mindestens 2\.190/);
    const zuHoch = margeAusPreis(m, "5000");
    expect(zuHoch.ok).toBe(false);
    if (!zuHoch.ok) expect(zuHoch.meldung).toMatch(/Höchstens 3\.840/);
  });

  it("nimmt genau die Grenzpreise an", () => {
    const g = preisGrenzen(m);
    const unten = margeAusPreis(m, String(g.minCent / 100));
    const oben = margeAusPreis(m, String(g.maxCent / 100));
    expect(unten.ok && unten.preisCent).toBe(g.minCent);
    expect(oben.ok && oben.preisCent).toBe(g.maxCent);
    expect(unten.ok && unten.prozent).toBeGreaterThanOrEqual(30);
    expect(oben.ok && oben.prozent).toBeLessThanOrEqual(60);
  });

  it("meldet leere Eingabe und fehlende Selbstkosten", () => {
    expect(margeAusPreis(m, "").ok).toBe(false);
    expect(margeAusPreis(m, "abc").ok).toBe(false);
    expect(margeAusPreis({ selbstkostenEur: 0, rundungEur: 10 }, "2000").ok).toBe(false);
  });

  it("trifft viele Preise exakt (Rundung 10 € und 50 €)", () => {
    for (const rundungEur of [10, 50]) {
      for (let s = 400; s < 9000; s += 377) {
        const g = preisGrenzen({ selbstkostenEur: s, rundungEur });
        for (let c = g.minCent; c <= g.maxCent; c += rundungEur * 100 * 7) {
          const r = margeAusPreis({ selbstkostenEur: s, rundungEur }, String(c / 100));
          if (!r.ok) throw new Error(`${s}/${c}: ${r.meldung}`);
          expect(r.preisCent).toBe(c);
        }
      }
    }
  });

  it("sagt ehrlich, wenn es genau diesen Preis nicht gibt (sehr hohe Selbstkosten nahe 60 %)", () => {
    const r = margeAusPreis({ selbstkostenEur: 33000, rundungEur: 10 }, "82490");
    if (!r.ok) throw new Error(r.meldung);
    expect(r.abweichend).toBe(true);
    expect(r.preisCent).toBe(preisBeiMarge(33000, r.prozent, 10) * 100);
    expect(r.preisCent).not.toBe(8249000);
  });

  it("ist bei üblichen Preisen nicht abweichend", () => {
    const r = margeAusPreis(m, "2450");
    expect(r.ok && r.abweichend).toBe(false);
  });
});
