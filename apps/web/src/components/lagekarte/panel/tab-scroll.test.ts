import { describe, expect, it } from "vitest";
import { MIN_INHALT_SICHTBAR_PX, startScrollFuerTab, chatLuecke } from "./tab-scroll";

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

describe("chatLuecke (keine Blase unter der klebenden Tab-Leiste)", () => {
  // Blasen in Bildschirm-Pixeln, 8 px Abstand; Tab-Leiste endet bei 146.
  const blasen = [
    { oben: 100, unten: 150 },
    { oben: 158, unten: 208 },
    { oben: 216, unten: 266 },
    { oben: 274, unten: 324 },
  ];

  it("liefert 0, wenn keine Blase von der Tab-Leiste angeschnitten wird", () => {
    expect(chatLuecke(blasen, 154)).toBe(0);
    expect(chatLuecke(blasen, 90)).toBe(0);
  });

  it("schiebt eine angeschnittene Blase ganz unter die Tab-Leiste (Lücke = ihr sichtbarer Rest)", () => {
    expect(chatLuecke(blasen, 146)).toBe(4);
    expect(chatLuecke(blasen, 170)).toBe(38);
  });

  it("schneidet nie die neueste Blase weg", () => {
    expect(chatLuecke(blasen, 300)).toBe(0);
    expect(chatLuecke([{ oben: 0, unten: 900 }], 146)).toBe(0);
  });

  it("ohne Blasen: 0", () => {
    expect(chatLuecke([], 146)).toBe(0);
  });
});
