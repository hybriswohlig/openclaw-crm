/**
 * Lagekarte: Farb- und Form-Tokens. MapLibre kann keine CSS-Variablen lesen,
 * deshalb liegen die Werte hier als TS-Konstanten (Legende und Karte teilen sie).
 * Palette auf Basis Okabe-Ito (farbfehlsichtig-tauglich), Farbe immer mit Form.
 */
import type { KartenStatus, WarteArt } from "./typen";

export type Thema = "hell" | "dunkel";

/** Markerform je Status. Farbe allein trägt nie die Information. */
export type MarkerForm = "kreis" | "ring" | "raute" | "sechseck" | "punkt" | "kreuz" | "quadrat";

export interface StatusStil {
  label: string;
  /** Kurzlabel für enge Chips */
  kurz: string;
  form: MarkerForm;
  farbe: Record<Thema, string>;
  /** Standardmäßig in der Karte sichtbar */
  standardSichtbar: boolean;
}

export const STATUS_STIL: Record<KartenStatus, StatusStil> = {
  neu: {
    label: "Neue Anfrage",
    kurz: "Neu",
    form: "kreis",
    farbe: { hell: "#0072B2", dunkel: "#4BA3E3" },
    standardSichtbar: true,
  },
  kontakt: {
    label: "In Kontakt",
    kurz: "Kontakt",
    form: "ring",
    farbe: { hell: "#3A8FC4", dunkel: "#7CC6F0" },
    standardSichtbar: true,
  },
  angebot: {
    label: "Angebot erstellt",
    kurz: "Angebot",
    form: "raute",
    farbe: { hell: "#A86F00", dunkel: "#F5B13D" },
    standardSichtbar: true,
  },
  auftrag: {
    label: "Auftrag fest",
    kurz: "Auftrag",
    form: "sechseck",
    farbe: { hell: "#008760", dunkel: "#2BC497" },
    standardSichtbar: true,
  },
  erledigt: {
    label: "Durchgeführt",
    kurz: "Erledigt",
    form: "punkt",
    farbe: { hell: "#767B84", dunkel: "#9AA0A8" },
    standardSichtbar: true,
  },
  verloren: {
    label: "Verloren",
    kurz: "Verloren",
    form: "kreuz",
    farbe: { hell: "#9A8F84", dunkel: "#7E848C" },
    standardSichtbar: false,
  },
  unbekannt: {
    label: "Stufe unbekannt",
    kurz: "Unbekannt",
    form: "quadrat",
    farbe: { hell: "#8a7f72", dunkel: "#8B93A1" },
    standardSichtbar: true,
  },
};

/** Zinnoberroter Ring für "wartet auf uns" (Overlay, kein Status). */
export const WARTET_FARBE: Record<Thema, string> = { hell: "#D55E00", dunkel: "#FF7A3D" };

export const WARTET_LABEL: Record<WarteArt, string> = {
  antwort: "Antwort ausstehend",
  neu_pruefen: "Neue Anfrage prüfen",
};

/** Spielbrett (Kreise) und Kulisse. */
export interface BrettFarben {
  hintergrund: string;
  ausserhalb: string;
  kreis: string;
  kreisAktiv: string;
  kreisKante: string;
  kreisLinie: string;
  landLinie: string;
  beschriftung: string;
  beschriftungHalo: string;
  clusterFuellung: string;
  clusterText: string;
  markerHalo: string;
  auswahl: string;
}

export const BRETT_FARBEN: Record<Thema, BrettFarben> = {
  hell: {
    hintergrund: "#efe8dc",
    ausserhalb: "#e6ddcd",
    kreis: "#f7f2ea",
    kreisAktiv: "#fbf6ec",
    kreisKante: "#cbbda5",
    kreisLinie: "#c9bca6",
    landLinie: "#221d16",
    beschriftung: "#5a5046",
    beschriftungHalo: "#fbf8f3",
    clusterFuellung: "#221d16",
    clusterText: "#fbf8f3",
    markerHalo: "#ffffff",
    auswahl: "#221d16",
  },
  dunkel: {
    hintergrund: "#0b1018",
    ausserhalb: "#0e1520",
    kreis: "#151d2a",
    kreisAktiv: "#1b2738",
    kreisKante: "#05080d",
    kreisLinie: "#2a3a54",
    landLinie: "#8fa3c7",
    beschriftung: "#9fb0cc",
    beschriftungHalo: "#0b1018",
    clusterFuellung: "#e8eefb",
    clusterText: "#0b1018",
    markerHalo: "#0b1018",
    auswahl: "#ffffff",
  },
};

/** Fallback-Firmenfarben, falls im Portal keine primary_color gepflegt ist. */
export const FIRMEN_FALLBACK_FARBE = "#5a5046";

/** Euro-Anzeige aus Cent, deutsch, ohne Nachkommastellen ab 1.000 €. */
export function euroAusCent(cent: number): string {
  const euro = cent / 100;
  return new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: Math.abs(euro) >= 1000 ? 0 : 2,
    minimumFractionDigits: 0,
  }).format(euro);
}
