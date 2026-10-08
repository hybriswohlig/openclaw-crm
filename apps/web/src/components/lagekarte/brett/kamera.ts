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
/**
 * BW großzügig erweitert: so weit darf man schieben. Breit genug, dass die Kamera ganz BW
 * neben Leiste und offenes Panel schieben kann (sonst zentriert maxBounds die Karte, sobald
 * der sichtbare Ausschnitt so breit ist wie die Grenzen, und BW läge halb unter der Leiste).
 */
export const MAX_GRENZEN: [number, number, number, number] = [3.0, 45.8, 15.0, 51.6];
export const MIN_ZOOM = 6.2;
export const MAX_ZOOM = 13.5;
/** Erster Aufbau: BW-Mitte, gleich danach ganz BW mit den Layout-Rändern (siehe startModus). */
export const START_ANSICHT = { longitude: 9.0, latitude: 48.65, zoom: 7.3 };

const FAHRT_MS = 900;
const NEIGUNG_MS = 700;
const GRENZEN_MAX_ZOOM = 10.5;
const AUSWAHL_MIN_ZOOM = 10.2;
/** Ruling 10: „Kerngebiet“ (Start und Knopf) nie näher als Zoom 9. */
export const KERN_MAX_ZOOM = 9;

/**
 * Ruling 10, erster Aufbau: zuerst ganz BW, nach INTRO_VERZOEGERUNG_MS ein Flug
 * (INTRO_FAHRT_MS) ins Kerngebiet; einmal je Sitzung (sessionStorage).
 */
export const INTRO_VERZOEGERUNG_MS = 500;
export const INTRO_FAHRT_MS = 1100;
export const INTRO_SCHLUESSEL = "kottke:lagekarte-intro";

/** „flug“: ganz BW, dann Flug ins Kerngebiet. „direkt“: gleich ins Kerngebiet, ohne Bewegung. */
export function startModus(z: { reduziert: boolean; schonGeflogen: boolean }): "flug" | "direkt" {
  return z.reduziert || z.schonGeflogen ? "direkt" : "flug";
}

export const NEIGUNG: Record<Ansicht, { pitch: number; bearing: number }> = {
  "2d": { pitch: 0, bearing: 0 },
  "3d": { pitch: 48, bearing: -12 },
};

/** Ab so vielen BW-Leads werden je Achse die äußeren 10 % als Ausreißer ignoriert. */
const AUSREISSER_AB = 8;
const AUSREISSER_ANTEIL = 0.1;

/** Rand in Pixeln (wie maplibre PaddingOptions, aber alle Seiten gesetzt). */
export type Rand = { top: number; bottom: number; left: number; right: number };

/** Abstand zwischen verdeckter Fläche und den eingepassten Leads. */
export const LUFT_PX = 16;

// Rückfall, solange der Container noch nichts gemessen hat (verdeckte Ränder ohne Luft).
// Desktop: HUD oben (~120 px), Leiste links (12 + 340 + 12), Legende unten (bis 3 Zeilen).
const VERDECKT_DESKTOP: Rand = { top: 120, bottom: 154, left: 364, right: 12 };
// Mobil: kompaktes HUD oben, unten Bottom-Sheet (Peek 184 px) plus Legenden-Leiste (44-px-Chips).
const VERDECKT_MOBIL: Rand = { top: 84, bottom: 254, left: 12, right: 12 };
/** Gleiche Grenze wie das Container-Layout (Leiste als Sheet unter lg, Fensterbreite). */
const DESKTOP_ABFRAGE = "(min-width: 1024px)";

/** Verdeckte Ränder ohne Messung des Containers (Fensterbreite entscheidet Desktop/mobil). */
export function standardVerdeckt(): Rand {
  return window.matchMedia(DESKTOP_ABFRAGE).matches ? VERDECKT_DESKTOP : VERDECKT_MOBIL;
}

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

/**
 * Kamera-Rand für fitBounds: die vom Container gemessenen verdeckten Ränder (HUD, Leiste,
 * offenes Panel, Legende bzw. Sheet) plus etwas Luft. Höchstens 70 % der Fläche je Achse,
 * sonst kann fitBounds nicht einpassen (das Verhältnis der Seiten bleibt).
 */
export function kameraPadding(breite: number, hoehe: number, verdeckt: Rand): Rand {
  const p = {
    top: verdeckt.top + LUFT_PX,
    bottom: verdeckt.bottom + LUFT_PX,
    left: verdeckt.left + LUFT_PX,
    right: verdeckt.right + LUFT_PX,
  };
  const fx = Math.min(1, (breite * 0.7) / (p.left + p.right));
  const fy = Math.min(1, (hoehe * 0.7) / (p.top + p.bottom));
  return { top: p.top * fy, bottom: p.bottom * fy, left: p.left * fx, right: p.right * fx };
}

/**
 * Versatz [x, y] des Auswahl-Ziels gegenüber der Kartenmitte: Mitte der freien Fläche
 * zwischen den verdeckten Rändern (flyTo `offset`; `padding` bliebe an der Karte hängen).
 * Ist zwischen oben und unten kein Platz (mobiles Sheet), die Mitte über der unteren Abdeckung.
 */
export function auswahlVersatz(breite: number, hoehe: number, verdeckt: Rand): [number, number] {
  const linksFrei = verdeckt.left;
  const rechtsFrei = breite - verdeckt.right;
  const x = rechtsFrei > linksFrei ? (linksFrei + rechtsFrei) / 2 : breite / 2;
  const obenFrei = verdeckt.top;
  const untenFrei = hoehe - verdeckt.bottom;
  const y = untenFrei > obenFrei ? (obenFrei + untenFrei) / 2 : Math.max(0, untenFrei) / 2;
  return [x - breite / 2, y - hoehe / 2];
}

function fahreZuGrenzen(
  map: MaplibreMap,
  grenzen: Grenzen,
  ansicht: Ansicht,
  verdeckt: Rand,
  dauer: number,
  maxZoom: number,
): void {
  const c = map.getContainer();
  map.fitBounds(grenzen, {
    padding: kameraPadding(c.clientWidth, c.clientHeight, verdeckt),
    duration: dauer,
    maxZoom,
    // fitBounds setzt sonst die Drehung auf 0 zurück.
    ...NEIGUNG[ansicht],
  });
}

/**
 * Führt einen Kamera-Befehl aus. `auswahl` ohne Ort tut nichts (Lead steht nur in Listen).
 * `verdeckt`: vom Layout verdeckte Ränder (Container misst sie), sonst Standardwerte.
 * `dauer`: 0 springt (erster Aufbau), sonst Fahrtdauer in ms.
 */
export function fahreKamera(
  map: MaplibreMap,
  ziel: KameraZiel,
  leads: LeadPunkt[],
  auswahl: LeadPunkt | null,
  ansicht: Ansicht,
  verdeckt: Rand = standardVerdeckt(),
  dauer: number = FAHRT_MS,
): void {
  switch (ziel) {
    case "kern":
      fahreZuGrenzen(map, kernGrenzen(leads), ansicht, verdeckt, dauer, KERN_MAX_ZOOM);
      return;
    case "bw":
      fahreZuGrenzen(map, BW_GRENZEN, ansicht, verdeckt, dauer, GRENZEN_MAX_ZOOM);
      return;
    case "alle":
      fahreZuGrenzen(map, alleGrenzen(leads), ansicht, verdeckt, dauer, GRENZEN_MAX_ZOOM);
      return;
    case "auswahl": {
      if (!auswahl?.ort) return;
      const c = map.getContainer();
      map.flyTo({
        center: [auswahl.ort.lng, auswahl.ort.lat],
        zoom: Math.max(map.getZoom(), AUSWAHL_MIN_ZOOM),
        offset: auswahlVersatz(c.clientWidth, c.clientHeight, verdeckt),
        duration: dauer,
      });
      return;
    }
  }
}

/** 2D/3D-Wechsel: Neigung und Drehung weich (sofort = ohne Animation, z. B. beim Aufbau). */
export function setzeNeigung(map: MaplibreMap, ansicht: Ansicht, sofort = false): void {
  if (sofort) map.jumpTo(NEIGUNG[ansicht]);
  else map.easeTo({ ...NEIGUNG[ansicht], duration: NEIGUNG_MS });
}
