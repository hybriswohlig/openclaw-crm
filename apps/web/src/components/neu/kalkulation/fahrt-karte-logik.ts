/**
 * Plan 15, Bauteil 12: Linien der Fahrt-Karte aus den Strecken der Fahrt und
 * den Teilstrecken des Routen-Caches (`deal_calculation_routes`). Rein, ohne React.
 *
 * - Anfahrt = Teilstrecke Station → Beladen, Tour = Beladen → Entladen (Hauptstrecke),
 *   Rückweg = dieselbe Hauptstrecke rückwärts, Rückfahrt = letzte Teilstrecke → Station.
 * - Ist eine Strecke im Rechner nur geschätzt (oder fehlt die Linie), zeichnet die
 *   Karte eine gestrichelte Gerade zwischen den bekannten Endpunkten; kennt sie die
 *   Endpunkte nicht, gibt es keine Linie.
 */
import type { FahrtStreckeAnsicht } from "@/lib/kalkulation-annahmen";
import { polylineDekodieren } from "./route-karte-bild-logik";
import type { Teilstrecke } from "./route-karte";

export type Punkt = [number, number];

export interface FahrtLinie {
  key: string;
  punkte: Punkt[];
  gestrichelt: boolean;
  farbe: string;
  label: string;
}

/** Eigene Farbe je Streckenart (Anfahrt blau, Tour vermilion, Rückweg gold, Rückfahrt violett). */
export const STRECKEN_FARBE: Record<FahrtStreckeAnsicht["art"], string> = {
  anfahrt: "#2f6fde",
  tour: "#f04a28",
  rueckweg: "#c98a00",
  rueckfahrt: "#7c4ddb",
};

export function streckenLabel(s: Pick<FahrtStreckeAnsicht, "art" | "tour" | "von" | "nach">): string {
  if (s.art === "tour") return `Tour ${s.tour}: ${s.von} → ${s.nach}`;
  if (s.art === "rueckweg") return `Rückweg ${s.tour}: ${s.von} → ${s.nach}`;
  return `${s.art === "anfahrt" ? "Anfahrt" : "Rückfahrt"}: ${s.von} → ${s.nach}`;
}

export function fahrtLinien(strecken: FahrtStreckeAnsicht[], teilstrecken: Teilstrecke[]): FahrtLinie[] {
  const linie = (t: Teilstrecke | undefined): Punkt[] => (t && t.polyline ? polylineDekodieren(t.polyline) : []);
  const anfahrt = linie(teilstrecken.find((t) => t.von === "Station"));
  const haupt = linie(teilstrecken.find((t) => t.haupt));
  const rueck = linie([...teilstrecken].reverse().find((t) => t.nach === "Station" && t.von !== "Station"));
  const station = anfahrt[0] ?? rueck.at(-1);
  const beladen = haupt[0] ?? anfahrt.at(-1);
  const entladen = haupt.at(-1) ?? rueck[0];
  const ort: Record<string, Punkt | undefined> = { Station: station, Beladen: beladen, Entladen: entladen };

  const aus: FahrtLinie[] = [];
  for (const s of strecken) {
    const echt =
      s.art === "anfahrt" ? anfahrt : s.art === "tour" ? haupt : s.art === "rueckweg" ? [...haupt].reverse() : rueck;
    const label = streckenLabel(s);
    if (!s.geschaetzt && echt.length > 1) {
      aus.push({ key: s.key, punkte: echt, gestrichelt: false, farbe: STRECKEN_FARBE[s.art], label });
      continue;
    }
    const a = ort[s.von];
    const b = ort[s.nach];
    if (a && b && (a[0] !== b[0] || a[1] !== b[1])) {
      aus.push({ key: s.key, punkte: [a, b], gestrichelt: true, farbe: STRECKEN_FARBE[s.art], label: `${label} · geschätzt, keine Route` });
    }
  }
  return aus;
}

/** Google-Maps-Link mit allen Wegpunkten in Fahrreihenfolge (Station, Beladen, Touren, Station). */
export function fahrtGoogleLink(p: { station: string | null; beladen: string | null; entladen: string | null }, touren: number): string | null {
  if (!p.station || !p.beladen) return null;
  const wege: string[] = [p.beladen];
  if (p.entladen) {
    for (let t = 1; t <= Math.max(1, touren); t++) {
      wege.push(p.entladen);
      if (t < touren) wege.push(p.beladen);
    }
  }
  return (
    "https://www.google.com/maps/dir/?api=1" +
    `&origin=${encodeURIComponent(p.station)}` +
    `&destination=${encodeURIComponent(p.station)}` +
    `&waypoints=${wege.map(encodeURIComponent).join("%7C")}` +
    "&travelmode=driving"
  );
}
