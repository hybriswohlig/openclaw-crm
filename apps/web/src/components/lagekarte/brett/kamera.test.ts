import { describe, expect, it } from "vitest";
import {
  auswahlVersatz,
  INTRO_FAHRT_MS,
  INTRO_VERZOEGERUNG_MS,
  KERN_MAX_ZOOM,
  kameraPadding,
  LUFT_PX,
  startModus,
  type Rand,
} from "./kamera";

describe("startModus (Ruling 10)", () => {
  it("erster Besuch der Sitzung ohne reduzierte Bewegung: Flug von ganz BW ins Kerngebiet", () => {
    expect(startModus({ reduziert: false, schonGeflogen: false })).toBe("flug");
  });
  it("reduzierte Bewegung: direkt ins Kerngebiet, nie ein Flug", () => {
    expect(startModus({ reduziert: true, schonGeflogen: false })).toBe("direkt");
    expect(startModus({ reduziert: true, schonGeflogen: true })).toBe("direkt");
  });
  it("in derselben Sitzung schon geflogen: direkt ins Kerngebiet", () => {
    expect(startModus({ reduziert: false, schonGeflogen: true })).toBe("direkt");
  });
  it("Zeiten und Zoom wie vorgegeben: ~500 ms warten, höchstens 1,2 s fliegen, Kerngebiet bis Zoom 9", () => {
    expect(INTRO_VERZOEGERUNG_MS).toBe(500);
    expect(INTRO_FAHRT_MS).toBeLessThanOrEqual(1200);
    expect(KERN_MAX_ZOOM).toBe(9);
  });
});

describe("kameraPadding", () => {
  const desktop: Rand = { top: 124, bottom: 150, left: 364, right: 12 };

  it("legt etwas Luft um die verdeckten Ränder", () => {
    expect(kameraPadding(1440, 900, desktop)).toEqual({
      top: 124 + LUFT_PX,
      bottom: 150 + LUFT_PX,
      left: 364 + LUFT_PX,
      right: 12 + LUFT_PX,
    });
  });

  it("offenes Panel: rechts Panelbreite plus Rand", () => {
    const p = kameraPadding(1440, 900, { ...desktop, right: 424 });
    expect(p.right).toBe(424 + LUFT_PX);
    expect(p.left).toBe(364 + LUFT_PX);
  });

  it("deckelt auf 70 % der Fläche je Achse, damit fitBounds noch einpassen kann", () => {
    const p = kameraPadding(1024, 700, { top: 124, bottom: 150, left: 364, right: 424 });
    expect(p.left + p.right).toBeCloseTo(1024 * 0.7, 5);
    // Verhältnis bleibt erhalten
    expect(p.left / p.right).toBeCloseTo((364 + LUFT_PX) / (424 + LUFT_PX), 5);
    expect(p.top).toBe(124 + LUFT_PX);
  });
});

describe("auswahlVersatz", () => {
  it("ohne verdeckte Ränder: Mitte", () => {
    expect(auswahlVersatz(1000, 800, { top: 0, bottom: 0, left: 0, right: 0 })).toEqual([0, 0]);
  });

  it("Desktop mit Leiste und Panel: Mitte der freien Fläche", () => {
    // frei: x 364..1016 (Mitte 690), y 124..750 (Mitte 437); Kartenmitte 720/450
    expect(auswahlVersatz(1440, 900, { top: 124, bottom: 150, left: 364, right: 424 })).toEqual([-30, -13]);
  });

  it("mobil mit Panel-Sheet: Marker in den sichtbaren oberen Bereich", () => {
    // 390×531, HUD bis 104, Sheet 345 hoch: frei y 104..186, Mitte 145 (Kartenmitte 265.5)
    const [x, y] = auswahlVersatz(390, 531, { top: 104, bottom: 345, left: 12, right: 12 });
    expect(x).toBe(0);
    expect(y).toBeCloseTo(145 - 265.5, 5);
  });

  it("kein freier Platz zwischen oben und unten: Mitte über der unteren Abdeckung", () => {
    const [, y] = auswahlVersatz(390, 531, { top: 104, bottom: 500, left: 12, right: 12 });
    expect(y).toBeCloseTo(31 / 2 - 265.5, 5);
  });
});
