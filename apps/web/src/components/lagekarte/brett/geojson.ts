/**
 * Lagekarte, Spielbrett: reine Umwandlung der Leads in GeoJSON für MapLibre.
 * Bewusst ohne maplibre-Import, damit vitest es direkt testen kann.
 */
import type { Thema } from "@/lib/lagekarte/farben";
import { plausiblerCent, type Firma, type KartenOrt, type KartenStatus, type LeadPunkt } from "@/lib/lagekarte/typen";

/** Kreisplättchen in 3D: Grundhöhe plus eine Stufe je Lead, gedeckelt. */
export const KREIS_BASIS_M = 600;
export const KREIS_STUFE_M = 900;
export const KREIS_STUFEN_MAX = 6;

/** Auftrags-Säulen in 3D: Höhe aus dem Wert, unbekannt = Mindesthöhe. */
export const SAEULE_MIN_M = 1200;
export const SAEULE_MAX_M = 9000;
/** 6.000 € (600.000 Cent) erreichen gerade die Deckelung. */
const SAEULE_M_PRO_CENT = (SAEULE_MAX_M - SAEULE_MIN_M) / 600_000;
export const SAEULE_RADIUS_M = 1200;

const METER_PRO_GRAD = 111_320;

export interface LeadEigenschaften {
  id: string;
  status: KartenStatus;
  /** Name des per icons.ts registrierten Bildes */
  icon: string;
  wartet: boolean;
}

export interface AuftragEigenschaften extends LeadEigenschaften {
  /** Bestätigter bzw. bester bekannter Wert in Cent; unbekannt oder unplausibel hoch = null. */
  wertCent: number | null;
}

export interface SaeulenEigenschaften {
  id: string;
  /** Eigene Höhe der Säule (ohne Sockel). */
  hoeheM: number;
  /** Sockel = Höhe des Kreisplättchens darunter (0 außerhalb BW). */
  basisM: number;
}

/** Bildname, wie icons.ts ihn registriert: `lk-${status}-${thema}` bzw. mit `-${firmaKurz}`. */
export function iconName(status: KartenStatus, thema: Thema, firmaKurz?: string | null): string {
  return firmaKurz ? `lk-${status}-${thema}-${firmaKurz}` : `lk-${status}-${thema}`;
}

function kurzNachFirma(firmen: Firma[]): Map<string, string> {
  return new Map(firmen.map((f) => [f.id, f.kurz]));
}

function punkt<P>(o: KartenOrt, properties: P): GeoJSON.Feature<GeoJSON.Point, P> {
  return { type: "Feature", properties, geometry: { type: "Point", coordinates: [o.lng, o.lat] } };
}

function eigenschaften(l: LeadPunkt, thema: Thema, kurz: Map<string, string>): LeadEigenschaften {
  return {
    id: l.id,
    status: l.status,
    icon: iconName(l.status, thema, l.firmaId ? kurz.get(l.firmaId) : null),
    wartet: l.wartet !== null,
  };
}

/**
 * Geclusterte Lead-Quelle: alle Leads mit Ort AUSSER Aufträgen
 * (die haben eine eigene, nie geclusterte Quelle, siehe auftraegeZuGeoJson).
 */
export function leadsZuGeoJson(
  leads: LeadPunkt[],
  thema: Thema,
  firmen: Firma[] = [],
): GeoJSON.FeatureCollection<GeoJSON.Point, LeadEigenschaften> {
  const kurz = kurzNachFirma(firmen);
  const features: GeoJSON.Feature<GeoJSON.Point, LeadEigenschaften>[] = [];
  for (const l of leads) {
    if (!l.ort || l.status === "auftrag") continue;
    features.push(punkt(l.ort, eigenschaften(l, thema, kurz)));
  }
  return { type: "FeatureCollection", features };
}

/** Ungeclusterte Auftrags-Quelle (Status auftrag mit Ort). */
export function auftraegeZuGeoJson(
  leads: LeadPunkt[],
  thema: Thema,
  firmen: Firma[] = [],
): GeoJSON.FeatureCollection<GeoJSON.Point, AuftragEigenschaften> {
  const kurz = kurzNachFirma(firmen);
  const features: GeoJSON.Feature<GeoJSON.Point, AuftragEigenschaften>[] = [];
  for (const l of leads) {
    if (!l.ort || l.status !== "auftrag") continue;
    // Unplausibel hohe Werte (Tippfehler) gelten für die Größe als unbekannt.
    features.push(punkt(l.ort, { ...eigenschaften(l, thema, kurz), wertCent: plausiblerCent(l.wert) }));
  }
  return { type: "FeatureCollection", features };
}

/** Anzahl Leads je Kreis (AGS). Leads ohne Ort oder ohne Kreis zählen nicht. */
export function kreisAktivitaet(leads: LeadPunkt[]): Record<string, number> {
  const zaehler: Record<string, number> = {};
  for (const l of leads) {
    const ags = l.ort?.kreisAgs;
    if (ags) zaehler[ags] = (zaehler[ags] ?? 0) + 1;
  }
  return zaehler;
}

/** Höhe eines Kreisplättchens in 3D, passend zum Ausdruck in stil.ts. */
export function kreisHoeheM(aktivitaet: number): number {
  return KREIS_BASIS_M + KREIS_STUFE_M * Math.min(Math.max(aktivitaet, 0), KREIS_STUFEN_MAX);
}

/** Säulenhöhe aus dem Wert: unbekannt = 1200 m, linear steigend, gedeckelt bei 9000 m. */
export function saeulenHoeheM(wertCent: number | null): number {
  if (wertCent === null) return SAEULE_MIN_M;
  return Math.round(Math.min(SAEULE_MAX_M, SAEULE_MIN_M + Math.max(wertCent, 0) * SAEULE_M_PRO_CENT));
}

/** Spitzes Sechseck (Ecke nach Norden) wie das Auftrags-Icon, geschlossen: 7 Koordinaten. */
function sechseck(o: KartenOrt, radiusM: number): GeoJSON.Position[] {
  const dLat = radiusM / METER_PRO_GRAD;
  const dLng = radiusM / (METER_PRO_GRAD * Math.cos((o.lat * Math.PI) / 180));
  const ecken: GeoJSON.Position[] = [];
  for (let i = 0; i < 6; i++) {
    const w = Math.PI / 6 + (Math.PI / 3) * i;
    ecken.push([o.lng + dLng * Math.cos(w), o.lat + dLat * Math.sin(w)]);
  }
  ecken.push(ecken[0]);
  return ecken;
}

/**
 * 3D-Türme: ein Sechseck je Auftrag mit Ort. Die Säule steht auf dem
 * angehobenen Kreisplättchen (basisM), damit sie nicht darin versinkt.
 */
export function auftragsSaeulen(
  leads: LeadPunkt[],
  radiusM: number = SAEULE_RADIUS_M,
): GeoJSON.FeatureCollection<GeoJSON.Polygon, SaeulenEigenschaften> {
  const aktivitaet = kreisAktivitaet(leads);
  const features: GeoJSON.Feature<GeoJSON.Polygon, SaeulenEigenschaften>[] = [];
  for (const l of leads) {
    if (!l.ort || l.status !== "auftrag") continue;
    const ags = l.ort.kreisAgs;
    features.push({
      type: "Feature",
      properties: {
        id: l.id,
        hoeheM: saeulenHoeheM(plausiblerCent(l.wert)),
        basisM: ags && ags.startsWith("08") ? kreisHoeheM(aktivitaet[ags] ?? 0) : 0,
      },
      geometry: { type: "Polygon", coordinates: [sechseck(l.ort, radiusM)] },
    });
  }
  return { type: "FeatureCollection", features };
}

function abstandM(a: KartenOrt, b: KartenOrt): number {
  const dy = (b.lat - a.lat) * METER_PRO_GRAD;
  const dx = (b.lng - a.lng) * METER_PRO_GRAD * Math.cos((((a.lat + b.lat) / 2) * Math.PI) / 180);
  return Math.hypot(dx, dy);
}

/**
 * A→B des gewählten Leads: flacher Bogen vom Abholort zum Ziel plus Zielpunkt.
 * Leer, wenn Ort oder Ziel fehlen oder beide praktisch gleich sind (gleiche PLZ
 * bzw. unter 500 m, das ist nur der Versatz).
 */
export function auswahlLinie(lead: LeadPunkt | null): GeoJSON.FeatureCollection<GeoJSON.LineString | GeoJSON.Point> {
  const a = lead?.ort;
  const b = lead?.ziel;
  if (!a || !b || (a.plz && a.plz === b.plz) || abstandM(a, b) < 500) {
    return { type: "FeatureCollection", features: [] };
  }

  // Quadratischer Bézier, Kontrollpunkt 18 % der Strecke seitlich versetzt (in Meter-Raum).
  const kos = Math.cos((((a.lat + b.lat) / 2) * Math.PI) / 180);
  const ax = a.lng * kos;
  const bx = b.lng * kos;
  const mx = (ax + bx) / 2;
  const my = (a.lat + b.lat) / 2;
  const dx = bx - ax;
  const dy = b.lat - a.lat;
  const cx = mx - dy * 0.18;
  const cy = my + dx * 0.18;
  const schritte = 32;
  const coords: GeoJSON.Position[] = [];
  for (let i = 0; i <= schritte; i++) {
    const t = i / schritte;
    const u = 1 - t;
    const x = u * u * ax + 2 * u * t * cx + t * t * bx;
    const y = u * u * a.lat + 2 * u * t * cy + t * t * b.lat;
    coords.push([x / kos, y]);
  }
  // Endpunkte exakt (keine Rundungsdrift durch / kos)
  coords[0] = [a.lng, a.lat];
  coords[schritte] = [b.lng, b.lat];

  return {
    type: "FeatureCollection",
    features: [
      { type: "Feature", properties: { teil: "linie" }, geometry: { type: "LineString", coordinates: coords } },
      { type: "Feature", properties: { teil: "ziel" }, geometry: { type: "Point", coordinates: [b.lng, b.lat] } },
    ],
  };
}
