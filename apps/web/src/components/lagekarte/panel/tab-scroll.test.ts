import { describe, expect, it } from "vitest";
import { MIN_INHALT_SICHTBAR_PX, startScrollFuerTab } from "./tab-scroll";

describe("startScrollFuerTab", () => {
  it("Desktop: Tab-Inhalt beginnt sichtbar, also oben bleiben (Fakten und Aktionen im Blick)", () => {
    // 1440×900: Rumpf 639 hoch, Tab-Leiste bei 390, 46 hoch.
    expect(startScrollFuerTab(390, 46, 639)).toBe(0);
  });

  it("iPhone 13: Tab-Inhalt läge unter dem sichtbaren Bereich, also Tab-Leiste oben kleben lassen", () => {
    // Rumpf 361 hoch, Tab-Leiste bei 387: Inhalt begänne erst bei 433.
    expect(startScrollFuerTab(387, 46, 361)).toBe(387);
  });

  it("Grenze: genau MIN_INHALT_SICHTBAR_PX Platz unter der Tab-Leiste reicht noch", () => {
    const sicht = 400;
    const tabsHoehe = 40;
    const grenze = sicht - MIN_INHALT_SICHTBAR_PX - tabsHoehe;
    expect(startScrollFuerTab(grenze, tabsHoehe, sicht)).toBe(0);
    expect(startScrollFuerTab(grenze + 1, tabsHoehe, sicht)).toBe(grenze + 1);
  });
});
