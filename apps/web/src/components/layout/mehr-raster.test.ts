import { describe, expect, it } from "vitest";
import { mehrKachelSpalte } from "./mehr-raster";

/** grid-column aller Kacheln, wie das „Mehr“-Blatt sie setzt. */
function spalten(anzahl: number): string[] {
  return Array.from({ length: anzahl }, (_, i) => mehrKachelSpalte(i, anzahl));
}

describe("mehrKachelSpalte", () => {
  it("zwei Kacheln in der letzten Reihe rücken eine Spalte ein und stehen mittig", () => {
    // 11 Einträge: drei volle Reihen, dann zwei Kacheln auf Spalte 2–3 und 4–5.
    const s = spalten(11);
    expect(s.slice(0, 9).every((w) => w === "span 2")).toBe(true);
    expect(s.slice(9)).toEqual(["2 / span 2", "span 2"]);
  });

  it("eine einzelne Kachel in der letzten Reihe steht in der Mitte", () => {
    // 10 Einträge: die letzte Kachel liegt auf Spalte 3–4 von 6.
    expect(spalten(10).slice(9)).toEqual(["3 / span 2"]);
    expect(spalten(1)).toEqual(["3 / span 2"]);
  });

  it("volle Reihen bleiben unverändert", () => {
    expect(spalten(9).every((w) => w === "span 2")).toBe(true);
    expect(spalten(3)).toEqual(["span 2", "span 2", "span 2"]);
  });
});
