import { describe, expect, it } from "vitest";
import { kartenStil, stationsFarbe } from "./karten-stil";

describe("kartenStil", () => {
  it("hell positron, dunkel dark", () => {
    expect(kartenStil("light")).toBe("https://tiles.openfreemap.org/styles/positron");
    expect(kartenStil("dark")).toBe("https://tiles.openfreemap.org/styles/dark");
  });
});

describe("stationsFarbe", () => {
  it("nimmt --ink-2 des Themes aus TOKENS", () => {
    expect(stationsFarbe("light")).toBe("#66666a");
    expect(stationsFarbe("dark")).toBe("#c7c7cc");
  });
});
