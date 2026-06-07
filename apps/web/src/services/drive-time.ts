/**
 * Drive-time estimation via Google Distance Matrix (with traffic).
 *
 * One service, two callers: the estimate-time API route (lazy on-demand) and
 * any future cron that wants to re-estimate stale Aufträge.
 *
 * Env: GOOGLE_MAPS_API_KEY must be set. If missing, the service throws a
 * specific error the route surfaces as a 503 so the UI can show "API-Key
 * fehlt — bitte in .env hinterlegen."
 */

export interface DriveLeg {
  fromLabel: string;
  toLabel: string;
  meters: number;
  /** seconds in traffic (best-guess departure now) */
  seconds: number;
  /** Google-formatted from/to as resolved */
  fromResolved?: string;
  toResolved?: string;
}

export interface DriveEstimate {
  legs: DriveLeg[];
  totalMeters: number;
  totalSeconds: number;
  /** ISO timestamp of the call */
  computedAt: string;
  /** raw Google status for the first failing leg, if any */
  warnings: string[];
}

interface GoogleElement {
  status: string;
  distance?: { value: number; text: string };
  duration?: { value: number; text: string };
  duration_in_traffic?: { value: number; text: string };
}

interface GoogleResponse {
  status: string;
  error_message?: string;
  origin_addresses: string[];
  destination_addresses: string[];
  rows: { elements: GoogleElement[] }[];
}

export class DriveTimeConfigError extends Error {}
export class DriveTimeAPIError extends Error {}

/**
 * Computes a depot → pickup → dropoff → depot round trip. Returns the three
 * legs and totals. Throws DriveTimeConfigError if API key missing,
 * DriveTimeAPIError on upstream failure.
 */
export async function estimateRoundTrip(input: {
  depot: { label: string; lat: number; lng: number };
  pickup: { label: string; address: string };
  dropoff: { label: string; address: string };
  /**
   * Optional pre-computed depot → pickup leg (e.g. from `rankDepotsToPickup`).
   * When supplied, the first leg is reused instead of issuing a fresh Distance
   * Matrix call — saves one request per estimate.
   */
  depotToPickup?: { meters: number; seconds: number };
}): Promise<DriveEstimate> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    throw new DriveTimeConfigError(
      "GOOGLE_MAPS_API_KEY is not configured. Set it in apps/web/.env to enable drive-time estimates."
    );
  }

  const leg1: Promise<{ leg: DriveLeg; warning?: string }> = input.depotToPickup
    ? Promise.resolve({
        leg: {
          fromLabel: input.depot.label,
          toLabel: input.pickup.label,
          meters: input.depotToPickup.meters,
          seconds: input.depotToPickup.seconds,
        },
      })
    : fetchLeg(apiKey, `${input.depot.lat},${input.depot.lng}`, input.pickup.address, input.depot.label, input.pickup.label);

  // 3 legs as separate pair queries — keeps things simple and lets a single
  // address-failure surface without poisoning the rest of the matrix.
  const legs = await Promise.all([
    leg1,
    fetchLeg(apiKey, input.pickup.address, input.dropoff.address, input.pickup.label, input.dropoff.label),
    fetchLeg(apiKey, input.dropoff.address, `${input.depot.lat},${input.depot.lng}`, input.dropoff.label, input.depot.label),
  ]);

  const warnings: string[] = [];
  let totalMeters = 0;
  let totalSeconds = 0;
  for (const l of legs) {
    if (l.warning) warnings.push(l.warning);
    totalMeters += l.leg.meters;
    totalSeconds += l.leg.seconds;
  }

  return {
    legs: legs.map((l) => l.leg),
    totalMeters,
    totalSeconds,
    computedAt: new Date().toISOString(),
    warnings,
  };
}

async function fetchLeg(
  apiKey: string,
  origin: string,
  destination: string,
  fromLabel: string,
  toLabel: string
): Promise<{ leg: DriveLeg; warning?: string }> {
  const url = new URL("https://maps.googleapis.com/maps/api/distancematrix/json");
  url.searchParams.set("origins", origin);
  url.searchParams.set("destinations", destination);
  url.searchParams.set("mode", "driving");
  url.searchParams.set("departure_time", "now");
  url.searchParams.set("traffic_model", "best_guess");
  url.searchParams.set("language", "de");
  url.searchParams.set("region", "de");
  url.searchParams.set("key", apiKey);

  const resp = await fetch(url.toString(), {
    headers: { "User-Agent": "openclaw-crm/drive-time" },
  });
  if (!resp.ok) {
    throw new DriveTimeAPIError(`Distance Matrix HTTP ${resp.status}`);
  }
  const data = (await resp.json()) as GoogleResponse;
  if (data.status !== "OK") {
    throw new DriveTimeAPIError(`Distance Matrix status ${data.status}: ${data.error_message ?? "(no message)"}`);
  }
  const el = data.rows[0]?.elements[0];
  if (!el) throw new DriveTimeAPIError("Distance Matrix returned no elements");

  if (el.status !== "OK") {
    return {
      leg: { fromLabel, toLabel, meters: 0, seconds: 0 },
      warning: `Strecke ${fromLabel} → ${toLabel}: ${el.status}`,
    };
  }

  return {
    leg: {
      fromLabel,
      toLabel,
      meters: el.distance?.value ?? 0,
      // Prefer traffic-adjusted seconds if available; fall back to plain duration.
      seconds: el.duration_in_traffic?.value ?? el.duration?.value ?? 0,
      fromResolved: data.origin_addresses[0],
      toResolved: data.destination_addresses[0],
    },
  };
}

// ─── Depot distance ranking ─────────────────────────────────────────────────

export interface DepotDistance {
  depotId: string;
  /** depot → pickup road distance in meters; Infinity when unreachable. */
  meters: number;
  /** depot → pickup drive seconds (traffic best-guess); Infinity when unreachable. */
  seconds: number;
  /** "OK" or the Google element status (e.g. "ZERO_RESULTS", "NOT_FOUND"). */
  status: string;
}

/**
 * Ranks every depot by real road distance to the pickup address using a SINGLE
 * Distance Matrix request per batch (depot coordinates as origins, the pickup
 * as the one destination). Returns one entry per depot sorted nearest-first;
 * depots Google could not route to sort last with Infinity distance.
 *
 * Origins are chunked into batches of 25 (the Distance Matrix per-request cap)
 * and run in parallel, so the ranking still works if the workspace ever holds
 * more than 25 active depots. Lets the caller auto-pick the closest Sixt center
 * and present the alternatives with their km/min in the UI.
 *
 * Throws DriveTimeConfigError if the API key is missing, DriveTimeAPIError on
 * an upstream/request-level failure (per-depot failures are reported via
 * `status`, not thrown).
 */
const DISTANCE_MATRIX_MAX_ORIGINS = 25;

export async function rankDepotsToPickup(input: {
  depots: { id: string; lat: number; lng: number }[];
  pickupAddress: string;
}): Promise<DepotDistance[]> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    throw new DriveTimeConfigError(
      "GOOGLE_MAPS_API_KEY is not configured. Set it in apps/web/.env to enable drive-time estimates."
    );
  }
  if (input.depots.length === 0) return [];

  const batches: { id: string; lat: number; lng: number }[][] = [];
  for (let i = 0; i < input.depots.length; i += DISTANCE_MATRIX_MAX_ORIGINS) {
    batches.push(input.depots.slice(i, i + DISTANCE_MATRIX_MAX_ORIGINS));
  }

  const batchResults = await Promise.all(
    batches.map((batch) => fetchDepotBatch(apiKey, batch, input.pickupAddress))
  );

  const out = batchResults.flat();
  out.sort((a, b) => a.seconds - b.seconds);
  return out;
}

/** One Distance Matrix request for a single batch of ≤25 depot origins. */
async function fetchDepotBatch(
  apiKey: string,
  depots: { id: string; lat: number; lng: number }[],
  pickupAddress: string
): Promise<DepotDistance[]> {
  const url = new URL("https://maps.googleapis.com/maps/api/distancematrix/json");
  url.searchParams.set("origins", depots.map((d) => `${d.lat},${d.lng}`).join("|"));
  url.searchParams.set("destinations", pickupAddress);
  url.searchParams.set("mode", "driving");
  url.searchParams.set("departure_time", "now");
  url.searchParams.set("traffic_model", "best_guess");
  url.searchParams.set("language", "de");
  url.searchParams.set("region", "de");
  url.searchParams.set("key", apiKey);

  const resp = await fetch(url.toString(), {
    headers: { "User-Agent": "openclaw-crm/drive-time" },
  });
  if (!resp.ok) {
    throw new DriveTimeAPIError(`Distance Matrix HTTP ${resp.status}`);
  }
  const data = (await resp.json()) as GoogleResponse;
  if (data.status !== "OK") {
    throw new DriveTimeAPIError(`Distance Matrix status ${data.status}: ${data.error_message ?? "(no message)"}`);
  }

  // origins map 1:1 to rows, in the order we sent them.
  return depots.map((d, i) => {
    const el = data.rows[i]?.elements[0];
    const meters = el?.distance?.value;
    const seconds = el?.duration_in_traffic?.value ?? el?.duration?.value;
    // Only treat as reachable when the element is OK AND both values exist,
    // so a malformed "OK" response can't leak a half-defined (Infinity) leg.
    if (!el || el.status !== "OK" || typeof meters !== "number" || typeof seconds !== "number") {
      return {
        depotId: d.id,
        meters: Infinity,
        seconds: Infinity,
        status: el ? (el.status === "OK" ? "NO_VALUES" : el.status) : "MISSING",
      };
    }
    return { depotId: d.id, meters, seconds, status: "OK" };
  });
}
