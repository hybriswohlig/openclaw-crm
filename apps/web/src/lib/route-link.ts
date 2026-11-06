/**
 * Route der Kalkulation (Station → Beladen → Entladen → Station): Link für
 * Google Maps mit genau diesen Wegpunkten, Schlüssel der Punkte und die
 * Hinweistexte je Status (aus `route-hinweise.ts`, das die Oberfläche
 * direkt importiert; diese Datei nutzt `node:crypto`).
 */
import { createHash } from "node:crypto";

export interface RoutenPunkte {
  station: string;
  beladen: string;
  entladen: string | null;
}

export type { RoutenStatus } from "./route-hinweise";
export { ROUTE_HINWEISE } from "./route-hinweise";

/** Google-Maps-Link: Start und Ziel = Station, dazwischen Beladen (und Entladen). */
export function googleMapsLink(p: RoutenPunkte): string {
  const wegpunkte = [p.beladen, ...(p.entladen ? [p.entladen] : [])].map(encodeURIComponent).join("%7C");
  return (
    "https://www.google.com/maps/dir/?api=1" +
    `&origin=${encodeURIComponent(p.station)}` +
    `&destination=${encodeURIComponent(p.station)}` +
    `&waypoints=${wegpunkte}` +
    "&travelmode=driving"
  );
}

/** Punkte zurück aus einem Link von `googleMapsLink` (gesperrte Version holt mit denselben Punkten neu). */
export function punkteAusLink(link: string): RoutenPunkte | null {
  try {
    const u = new URL(link);
    const station = u.searchParams.get("origin");
    const [beladen, entladen] = (u.searchParams.get("waypoints") ?? "").split("|");
    if (!station || !beladen) return null;
    return { station, beladen, entladen: entladen || null };
  } catch {
    return null;
  }
}

const norm = (s: string | null) => (s ?? "").toLowerCase().replace(/\s+/g, " ").trim();

/** sha256-Hex aus Station, Beladen, Entladen (klein, Leerzeichen zusammengezogen). */
export function punkteSchluessel(p: RoutenPunkte): string {
  return createHash("sha256")
    .update(JSON.stringify([norm(p.station), norm(p.beladen), norm(p.entladen)]))
    .digest("hex");
}
