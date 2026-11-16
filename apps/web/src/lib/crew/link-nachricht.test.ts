import { describe, expect, it } from "vitest";
import { CREW_LOCALES } from "./contract";
import { crewLinkNachricht, vorname } from "./link-nachricht";

describe("crewLinkNachricht", () => {
  const url = "https://crew.example/l/AbCdEfGhIjKlMnOpQrStUvWxYz012345";

  it("jede Sprache enthält Vorname und den ganzen Link, ohne Firmennamen", () => {
    for (const l of CREW_LOCALES) {
      const t = crewLinkNachricht(l, "Mehmet Ali Yilmaz", url);
      expect(t, l).toContain("Mehmet");
      expect(t, l).not.toContain("Yilmaz");
      expect(t, l).toContain(`\n${url}\n`);
      expect(t, l).not.toMatch(/kottke|rümpel|ruempel|ceylan|büro/i);
    }
  });

  it("Deutsch als Rückfall", () => {
    expect(crewLinkNachricht("xx" as never, "Ben", url)).toBe(crewLinkNachricht("de", "Ben", url));
  });

  it("vorname", () => {
    expect(vorname("  Ali   Can ")).toBe("Ali");
    expect(vorname("")).toBe("");
  });
});
