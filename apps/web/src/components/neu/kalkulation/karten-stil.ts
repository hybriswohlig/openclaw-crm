import { TOKENS, type LgTheme } from "@/lib/dunkel-abschaltung";

/**
 * Plan 14b, Task K: Kartenstil der Routenkarte je Theme (OpenFreeMap). Hell „positron“
 * wie bisher, dunkel „dark“ (geprüft am 09.11.2026: tiles.openfreemap.org/styles/dark
 * antwortet 200 mit einem MapLibre-Stil). Die Linie bleibt Vermilion.
 */
export const KARTEN_STILE: Record<LgTheme, string> = {
  light: "https://tiles.openfreemap.org/styles/positron",
  dark: "https://tiles.openfreemap.org/styles/dark",
};

export function kartenStil(theme: LgTheme): string {
  return KARTEN_STILE[theme];
}

/** Farbe der gestrichelten Stationswege: --ink-2 des Themes, direkt aus TOKENS. */
export function stationsFarbe(theme: LgTheme): string {
  return TOKENS["--ink-2"][theme === "dark" ? "dunkel" : "hell"];
}
