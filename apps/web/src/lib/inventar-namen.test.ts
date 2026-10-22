import { describe, expect, it } from "vitest";
import { namesMatch } from "./inventar-namen";

// Chat items and photo items are merged when their names match. A plain
// substring rule merged different furniture (6 chairs vanished into one
// "Bürostuhl", "Bett" became 4 beds via "Bettwäsche-Karton"), which skews
// the volume and therefore the KV price. Only whole words may match.
describe("namesMatch", () => {
  it.each([
    ["Sofa", "3-Sitzer-Sofa"],
    ["Kleiderschrank", "Kleiderschrank 3-türig"],
    ["Waschmaschine", "waschmaschine"],
    ["Couchtisch (Glas)", "Couchtisch"],
  ])("merges %s and %s", (a, b) => {
    expect(namesMatch(a, b)).toBe(true);
    expect(namesMatch(b, a)).toBe(true);
  });

  it.each([
    ["Bett", "Bettwäsche-Karton"],
    ["Tisch", "Nachttisch"],
    ["Stuhl", "Bürostuhl"],
    ["Schrank", "Schuhschrank"],
    ["Karton", "Bücherkarton"],
  ])("keeps %s and %s apart", (a, b) => {
    expect(namesMatch(a, b)).toBe(false);
    expect(namesMatch(b, a)).toBe(false);
  });

  it("never matches empty names", () => {
    expect(namesMatch("", "Sofa")).toBe(false);
    expect(namesMatch("  ", "")).toBe(false);
  });
});
