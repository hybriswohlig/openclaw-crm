/**
 * Google Places API (New) wrapper — Autocomplete + Place Details.
 *
 * Used by the Auftrag Zeitschätzung's "Adresse eintragen" inline fallback
 * when a Lead is missing addresses. Server-side only — the API key never
 * leaves the function runtime.
 *
 * Billing model: the New Places API supports session tokens. The client
 * generates one UUID per "address picking session" (typing → seeing
 * predictions → picking one → fetching details) and passes it to BOTH the
 * autocomplete and the detail call. Google bills a single session as long
 * as the token matches and the calls happen within ~3 minutes.
 *
 * Docs:
 *   https://developers.google.com/maps/documentation/places/web-service/place-autocomplete
 *   https://developers.google.com/maps/documentation/places/web-service/place-details
 */

export interface PlacePrediction {
  placeId: string;
  mainText: string;
  secondaryText: string;
  fullText: string;
}

export interface PlaceLocation {
  /** "Heilbronner Straße 339" (street + number) */
  line1: string;
  postcode: string;
  city: string;
  /** ISO 3166-1 alpha-2, e.g. "DE" */
  countryCode: string;
  /** Free-form formatted address as Google returns it. Useful for display + Distance Matrix. */
  formattedAddress: string;
}

export class PlacesConfigError extends Error {}
export class PlacesAPIError extends Error {}

const BASE = "https://places.googleapis.com/v1";

function requireKey(): string {
  const k = process.env.GOOGLE_MAPS_API_KEY;
  if (!k) {
    throw new PlacesConfigError(
      "GOOGLE_MAPS_API_KEY is not configured."
    );
  }
  return k;
}

/**
 * Search for address predictions. Biased to Germany; restricts result
 * types to addresses (no businesses) since this is for moving destinations.
 */
export async function autocompleteAddress(input: {
  text: string;
  sessionToken: string;
  /** Bias center, e.g. Stuttgart's lat/lng for radius-weighted results. */
  bias?: { lat: number; lng: number; radiusMeters?: number };
}): Promise<PlacePrediction[]> {
  const apiKey = requireKey();
  const trimmed = input.text.trim();
  if (trimmed.length < 2) return [];

  const body: Record<string, unknown> = {
    input: trimmed,
    sessionToken: input.sessionToken,
    languageCode: "de",
    regionCode: "DE",
    includedRegionCodes: ["DE", "AT", "CH"],
    // address-only — drop POIs / businesses
    includedPrimaryTypes: ["street_address", "premise", "subpremise", "route"],
  };
  if (input.bias) {
    body.locationBias = {
      circle: {
        center: { latitude: input.bias.lat, longitude: input.bias.lng },
        radius: input.bias.radiusMeters ?? 50_000,
      },
    };
  }

  const resp = await fetch(`${BASE}/places:autocomplete`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask":
        "suggestions.placePrediction.placeId,suggestions.placePrediction.text,suggestions.placePrediction.structuredFormat",
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const detail = await resp.text().catch(() => "");
    throw new PlacesAPIError(`autocomplete HTTP ${resp.status}: ${detail.slice(0, 200)}`);
  }

  const data = (await resp.json()) as {
    suggestions?: Array<{
      placePrediction?: {
        placeId: string;
        text?: { text?: string };
        structuredFormat?: {
          mainText?: { text?: string };
          secondaryText?: { text?: string };
        };
      };
    }>;
  };

  return (data.suggestions ?? [])
    .map((s): PlacePrediction | null => {
      const p = s.placePrediction;
      if (!p?.placeId) return null;
      return {
        placeId: p.placeId,
        mainText: p.structuredFormat?.mainText?.text ?? p.text?.text ?? "",
        secondaryText: p.structuredFormat?.secondaryText?.text ?? "",
        fullText: p.text?.text ?? "",
      };
    })
    .filter((p): p is PlacePrediction => p !== null);
}

/**
 * Fetch full address components for a previously-returned placeId. Maps the
 * Google addressComponents shape onto our LocationValue (line1, postcode,
 * city, countryCode) so it can be PATCHed straight onto a Lead.
 */
export async function placeDetail(input: {
  placeId: string;
  sessionToken: string;
}): Promise<PlaceLocation | null> {
  const apiKey = requireKey();

  const url = new URL(`${BASE}/places/${encodeURIComponent(input.placeId)}`);
  url.searchParams.set("languageCode", "de");
  url.searchParams.set("regionCode", "DE");
  url.searchParams.set("sessionToken", input.sessionToken);

  const resp = await fetch(url.toString(), {
    headers: {
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": "id,formattedAddress,addressComponents",
    },
  });

  if (resp.status === 404) return null;
  if (!resp.ok) {
    const detail = await resp.text().catch(() => "");
    throw new PlacesAPIError(`details HTTP ${resp.status}: ${detail.slice(0, 200)}`);
  }

  const data = (await resp.json()) as {
    formattedAddress?: string;
    addressComponents?: Array<{
      longText?: string;
      shortText?: string;
      types?: string[];
    }>;
  };

  const components = data.addressComponents ?? [];
  const pick = (type: string, prefer: "long" | "short" = "long"): string | undefined => {
    const c = components.find((x) => (x.types ?? []).includes(type));
    if (!c) return undefined;
    return prefer === "short" ? c.shortText ?? c.longText : c.longText ?? c.shortText;
  };

  const streetNumber = pick("street_number") ?? "";
  const route = pick("route") ?? "";
  const line1 = [route, streetNumber].filter(Boolean).join(" ").trim();

  return {
    line1,
    postcode: pick("postal_code") ?? "",
    city: pick("locality") ?? pick("postal_town") ?? "",
    countryCode: (pick("country", "short") ?? "DE").toUpperCase(),
    formattedAddress: data.formattedAddress ?? "",
  };
}
