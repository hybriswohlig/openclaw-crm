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
}): Promise<DriveEstimate> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    throw new DriveTimeConfigError(
      "GOOGLE_MAPS_API_KEY is not configured. Set it in apps/web/.env to enable drive-time estimates."
    );
  }

  // 3 legs as separate pair queries — keeps things simple and lets a single
  // address-failure surface without poisoning the rest of the matrix.
  const legs = await Promise.all([
    fetchLeg(apiKey, `${input.depot.lat},${input.depot.lng}`, input.pickup.address, input.depot.label, input.pickup.label),
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
