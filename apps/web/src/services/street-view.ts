/**
 * Google Street View Static API wrapper.
 *
 * Server-side only — never exposes the API key to the browser. The /api/v1/
 * maps/streetview proxy route uses this to fetch the image bytes and stream
 * them back to the UI (and to embed them base64 in the Auftragsanweisung
 * skill payload).
 *
 * Doc: https://developers.google.com/maps/documentation/streetview/overview
 */

export interface StreetViewParams {
  address: string;
  /** Image size in pixels, max 640x640 on the free tier. */
  width?: number;
  height?: number;
  /** 0 (zoomed out) to 100 (zoomed in). Default 90 — roughly normal lens. */
  fov?: number;
  /** Compass heading (0=N, 90=E …). Omit to let Google pick. */
  heading?: number;
  /** Up/down tilt: -90 to 90. */
  pitch?: number;
}

export class StreetViewConfigError extends Error {}
export class StreetViewAPIError extends Error {}

/**
 * Fetches one Street View image as raw bytes. Returns null if Google reports
 * "ZERO_RESULTS" (no panorama within reasonable radius) — the UI then shows
 * a neutral placeholder instead of an error.
 */
export async function fetchStreetView(
  p: StreetViewParams
): Promise<{ bytes: Buffer; mime: string } | null> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    throw new StreetViewConfigError(
      "GOOGLE_MAPS_API_KEY is not configured. Set it in apps/web/.env.local."
    );
  }
  if (!p.address || p.address.trim().length === 0) {
    throw new StreetViewAPIError("address is required");
  }

  // First check whether a panorama exists at all — saves billing on a real
  // image request if Street View has nothing here.
  const meta = new URL("https://maps.googleapis.com/maps/api/streetview/metadata");
  meta.searchParams.set("location", p.address);
  meta.searchParams.set("key", apiKey);
  const metaResp = await fetch(meta.toString());
  if (!metaResp.ok) {
    throw new StreetViewAPIError(`metadata HTTP ${metaResp.status}`);
  }
  const metaJson = (await metaResp.json()) as { status: string };
  if (metaJson.status === "ZERO_RESULTS" || metaJson.status === "NOT_FOUND") {
    return null;
  }
  if (metaJson.status !== "OK") {
    throw new StreetViewAPIError(`metadata status ${metaJson.status}`);
  }

  // Pull the image
  const img = new URL("https://maps.googleapis.com/maps/api/streetview");
  img.searchParams.set("location", p.address);
  img.searchParams.set("size", `${p.width ?? 600}x${p.height ?? 400}`);
  img.searchParams.set("fov", String(p.fov ?? 90));
  if (typeof p.heading === "number") img.searchParams.set("heading", String(p.heading));
  if (typeof p.pitch === "number") img.searchParams.set("pitch", String(p.pitch));
  img.searchParams.set("key", apiKey);

  const imgResp = await fetch(img.toString());
  if (!imgResp.ok) {
    throw new StreetViewAPIError(`image HTTP ${imgResp.status}`);
  }
  const arr = new Uint8Array(await imgResp.arrayBuffer());
  return {
    bytes: Buffer.from(arr),
    mime: imgResp.headers.get("content-type") ?? "image/jpeg",
  };
}
