import { describe, expect, it } from "vitest";
import { kartenStil } from "./karten-stil";

describe("kartenStil", () => {
  it("hell positron, dunkel dark", () => {
    expect(kartenStil("light")).toBe("https://tiles.openfreemap.org/styles/positron");
    expect(kartenStil("dark")).toBe("https://tiles.openfreemap.org/styles/dark");
  });
});
