/**
 * Lagekarte, Spielbrett: Kamera. Grenzen sind reine Funktionen (getestet in
 * geojson.test.ts), die Fahrten rufen nur MapLibre-Kamera-Methoden auf.
 * Nie `essential: true`: bei prefers-reduced-motion springt MapLibre dann sofort.
 */
import type { Map as MaplibreMap } from "maplibre-gl";
import type { LeadPunkt } from "@/lib/lagekarte/typen";

export type Ansicht = "2d" | "3d";
export type KameraZiel = "kern" | "bw" | "auswahl" | "alle";
/** [[West, Süd], [Ost, Nord]] */
export type Grenzen = [[number, number], [number, number]];

export const BW_GRENZEN: Grenzen = [
  [7.5, 47.5],
  [10.5, 49.8],
];
/** BW großzügig erweitert: so weit darf man schieben. */
export const MAX_GRENZEN: [number, number, number, number] = [5.5, 46.8, 12.5, 50.6];
export const MIN_ZOOM = 6.2;
export const MAX_ZOOM = 13.5;
/** Erster Aufbau: BW-Mitte, danach einmal „kern“. */
export const START_ANSICHT = { longitude: 9.0, latitude: 48.65, zoom: 7.3 };

const FAHRT_MS = 900;
const NEIGUNG_MS = 700;
const GRENZEN_MAX_ZOOM = 10.5;
const AUSWAHL_MIN_ZOOM = 10.2;

export const NEIGUNG: Record<Ansicht, { pitch: number; bearing: number }> = {
  "2d": { pitch: 0, bearing: 0 },
  "3d": { pitch: 48, bearing: -12 },
};

/** Ab so vielen BW-Leads werden je Achse die äußeren 10 % als Ausreißer ignoriert. */
const AUSREISSER_AB = 8;
const AUSREISSER_ANTEIL = 0.1;

/** Rand in Pixeln (wie maplibre PaddingOptions, aber alle Seiten gesetzt). */
export type Rand = { top: number; bottom: number; left: number; right: number };

// Desktop: HUD oben (~120 px), Leiste links (12 + 340), Legende unten (bis 3 Zeilen).
const PADDING_DESKTOP: Rand = { top: 136, bottom: 170, left: 380, right: 60 };
// Mobil: kompaktes HUD oben, unten Bottom-Sheet (Peek 184 px) plus Legenden-Leiste (44-px-Chips).
const PADDING_MOBIL: Rand = { top: 100, bottom: 270, left: 28, right: 28 };
/** Gleiche Grenze wie das Container-Layout (Leiste als Sheet unter lg, Fensterbreite). */
const DESKTOP_ABFRAGE = "(min-width: 1024px)";

function quantil(sortiert: number[], q: number): number {
  const pos = (sortiert.length - 1) * q;
  const i = Math.floor(pos);
  if (i + 1 >= sortiert.length) return sortiert[sortiert.length - 1];
  return sortiert[i] + (sortiert[i + 1] - sortiert[i]) * (pos - i);
}

/**
 * Kerngebiet: Bounds der Leads in BW (Kreis-AGS beginnt mit „08“). Leads
 * außerhalb BW zählen nicht; ab 8 Leads fallen je Achse die äußeren 10 % weg,
 * damit vereinzelte Anfragen am Landesrand die Kamera nicht verschieben.
 * Ohne BW-Leads: ganz BW.
 */
export function kernGrenzen(leads: LeadPunkt[]): Grenzen {
  const orte = leads.flatMap((l) => (l.ort && l.ort.kreisAgs?.startsWith("08") ? [l.ort] : []));
  if (orte.length === 0) return BW_GRENZEN;
  const lngs = orte.map((o) => o.lng).sort((a, b) => a - b);
  const lats = orte.map((o) => o.lat).sort((a, b) => a - b);
  const q = orte.length >= AUSREISSER_AB ? AUSREISSER_ANTEIL : 0;
  return [
    [quantil(lngs, q), quantil(lats, q)],
    [quantil(lngs, 1 - q), quantil(lats, 1 - q)],
  ];
}

/** „Alles“: ganz BW plus jeder verortete Lead, auch außerhalb. */
export function alleGrenzen(leads: LeadPunkt[]): Grenzen {
  let [[w, s], [o, n]] = BW_GRENZEN;
  for (const l of leads) {
    if (!l.ort) continue;
    w = Math.min(w, l.ort.lng);
    s = Math.min(s, l.ort.lat);
    o = Math.max(o, l.ort.lng);
    n = Math.max(n, l.ort.lat);
  }
  return [
    [w, s],
    [o, n],
  ];
}

/** Platz für Leiste (links), HUD (oben) und Legende (unten); mobil HUD und Sheet. */
export function kameraPadding(breite: number, hoehe: number, desktop: boolean): Rand {
  const p = desktop ? PADDING_DESKTOP : PADDING_MOBIL;
  // Höchstens 70 % der Fläche als Rand, sonst kann fitBounds nicht einpassen.
  const fx = Math.min(1, (breite * 0.7) / (p.left + p.right));
  const fy = Math.min(1, (hoehe * 0.7) / (p.top + p.bottom));
  return { top: p.top * fy, bottom: p.bottom * fy, left: p.left * fx, right: p.right * fx };
}

function fahreZuGrenzen(map: MaplibreMap, grenzen: Grenzen, ansicht: Ansicht): void {
  const c = map.getContainer();
  map.fitBounds(grenzen, {
    padding: kameraPadding(c.clientWidth, c.clientHeight, window.matchMedia(DESKTOP_ABFRAGE).matches),
    duration: FAHRT_MS,
    maxZoom: GRENZEN_MAX_ZOOM,
    // fitBounds setzt sonst die Drehung auf 0 zurück.
    ...NEIGUNG[ansicht],
  });
}

/** Führt einen Kamera-Befehl aus. `auswahl` ohne Ort tut nichts (Lead steht nur in Listen). */
export function fahreKamera(
  map: MaplibreMap,
  ziel: KameraZiel,
  leads: LeadPunkt[],
  auswahl: LeadPunkt | null,
  ansicht: Ansicht,
): void {
  switch (ziel) {
    case "kern":
      fahreZuGrenzen(map, kernGrenzen(leads), ansicht);
      return;
    case "bw":
      fahreZuGrenzen(map, BW_GRENZEN, ansicht);
      return;
    case "alle":
      fahreZuGrenzen(map, alleGrenzen(leads), ansicht);
      return;
    case "auswahl":
      if (!auswahl?.ort) return;
      map.flyTo({
        center: [auswahl.ort.lng, auswahl.ort.lat],
        zoom: Math.max(map.getZoom(), AUSWAHL_MIN_ZOOM),
        duration: FAHRT_MS,
      });
      return;
  }
}

/** 2D/3D-Wechsel: Neigung und Drehung weich (sofort = ohne Animation, z. B. beim Aufbau). */
export function setzeNeigung(map: MaplibreMap, ansicht: Ansicht, sofort = false): void {
  if (sofort) map.jumpTo(NEIGUNG[ansicht]);
  else map.easeTo({ ...NEIGUNG[ansicht], duration: NEIGUNG_MS });
}
