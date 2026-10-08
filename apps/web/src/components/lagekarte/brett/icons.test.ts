import { describe, expect, it } from "vitest";
import { abgerundetesRechteck, type RechteckPfad } from "./icons";

function aufzeichner() {
  const aufrufe: Array<[string, ...number[]]> = [];
  const ctx: RechteckPfad = {
    moveTo: (x, y) => void aufrufe.push(["moveTo", x, y]),
    arcTo: (x1, y1, x2, y2, r) => void aufrufe.push(["arcTo", x1, y1, x2, y2, r]),
    closePath: () => void aufrufe.push(["closePath"]),
  };
  return { ctx, aufrufe };
}

describe("abgerundetesRechteck", () => {
  it("zeichnet das Quadrat mit vier Bögen und braucht kein roundRect", () => {
    const { ctx, aufrufe } = aufzeichner();
    abgerundetesRechteck(ctx, 9.5, 9.5, 13, 13, 2.5);
    expect(aufrufe).toEqual([
      ["moveTo", 12, 9.5],
      ["arcTo", 22.5, 9.5, 22.5, 22.5, 2.5],
      ["arcTo", 22.5, 22.5, 9.5, 22.5, 2.5],
      ["arcTo", 9.5, 22.5, 9.5, 9.5, 2.5],
      ["arcTo", 9.5, 9.5, 22.5, 9.5, 2.5],
      ["closePath"],
    ]);
  });

  it("begrenzt den Radius auf die halbe kürzere Seite und nie unter 0", () => {
    const gross = aufzeichner();
    abgerundetesRechteck(gross.ctx, 0, 0, 10, 4, 9);
    expect(gross.aufrufe[1]).toEqual(["arcTo", 10, 0, 10, 4, 2]);
    const negativ = aufzeichner();
    abgerundetesRechteck(negativ.ctx, 0, 0, 10, 10, -3);
    expect(negativ.aufrufe[0]).toEqual(["moveTo", 0, 0]);
    expect(negativ.aufrufe[1]).toEqual(["arcTo", 10, 0, 10, 10, 0]);
  });
});
