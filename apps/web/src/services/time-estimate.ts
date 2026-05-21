/**
 * Load/unload time estimation + depot auto-picker.
 *
 * Pure functions — no I/O. The route layer hands these the numbers it
 * already loaded from the Auftrag + Lead.
 */

export interface LoadUnloadInput {
  volumeCbm: number | null;
  workerCount: number | null;
  floorsFrom: number | null;
  floorsTo: number | null;
  elevatorFrom: string | null; // resolved option title: Aufzug | Treppe | Erdgeschoss | Nicht nötig (Einfamilienhaus)
  elevatorTo: string | null;
  walkingDistanceFromM: number | null;
  walkingDistanceToM: number | null;
}

/**
 * Returns an estimate of combined load + unload minutes.
 *
 * Formula (tunable — keep simple, document the assumptions):
 *   per-worker throughput:           4 minutes per m³ per worker
 *   floor penalty (no elevator):     2 minutes per cbm per floor, per side
 *   floor penalty (elevator):        0.4 minutes per cbm per floor, per side
 *   walking distance penalty:        0.5 minutes per m per side
 *   floor 0 / Erdgeschoss / Nicht nötig: no floor penalty
 *
 * Defaults if a field is null: volume 20m³, workers 2, floors 0,
 * elevator unknown → treat as "Treppe".
 */
export function estimateLoadUnloadMinutes(i: LoadUnloadInput): number {
  const volume = i.volumeCbm ?? 20;
  const workers = Math.max(1, i.workerCount ?? 2);

  const baseLoad = (volume * 4) / workers;
  const floorFrom = floorPenaltyMinutes(volume, i.floorsFrom, i.elevatorFrom);
  const floorTo = floorPenaltyMinutes(volume, i.floorsTo, i.elevatorTo);
  const walkFrom = walkingPenaltyMinutes(i.walkingDistanceFromM);
  const walkTo = walkingPenaltyMinutes(i.walkingDistanceToM);

  // baseLoad covers BOTH ends of the move (loading + unloading), so don't
  // double-count it. Penalties are per side.
  return Math.round(baseLoad + floorFrom + floorTo + walkFrom + walkTo);
}

function floorPenaltyMinutes(
  volume: number,
  floors: number | null,
  elevator: string | null
): number {
  if (!floors || floors <= 0) return 0;
  if (elevator === "Erdgeschoss" || elevator === "Nicht nötig (Einfamilienhaus)") return 0;
  const perFloor = elevator === "Aufzug" ? 0.4 : 2;
  return volume * floors * perFloor;
}

function walkingPenaltyMinutes(meters: number | null): number {
  if (!meters || meters <= 0) return 0;
  return meters * 0.5;
}

// ─── Depot auto-pick ────────────────────────────────────────────────────────

export interface DepotCandidate {
  id: string;
  name: string;
  lat: number;
  lng: number;
  cityTag: string | null;
  plzPrefixes: string | null;
  serviceRadiusKm: number | null;
  active: boolean;
}

/**
 * Pick the best depot for a Lead based on (in priority order):
 *  1. PLZ prefix match against active depots
 *  2. Nearest active depot by Haversine distance to lat/lng if available
 *  3. First active depot as fallback
 *
 * Returns null if no active depots exist.
 */
export function pickDepot(
  depots: DepotCandidate[],
  pickup: { plz?: string | null; lat?: number | null; lng?: number | null } | null
): DepotCandidate | null {
  const active = depots.filter((d) => d.active);
  if (active.length === 0) return null;
  if (!pickup) return active[0]!;

  if (pickup.plz) {
    const prefix2 = pickup.plz.slice(0, 2);
    const byPlz = active.find((d) =>
      (d.plzPrefixes ?? "")
        .split(",")
        .map((p) => p.trim())
        .includes(prefix2)
    );
    if (byPlz) return byPlz;
  }

  if (typeof pickup.lat === "number" && typeof pickup.lng === "number") {
    let best = active[0]!;
    let bestKm = haversineKm(pickup.lat, pickup.lng, best.lat, best.lng);
    for (const d of active.slice(1)) {
      const km = haversineKm(pickup.lat, pickup.lng, d.lat, d.lng);
      if (km < bestKm) {
        best = d;
        bestKm = km;
      }
    }
    return best;
  }

  return active[0]!;
}

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
