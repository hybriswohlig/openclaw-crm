// POST /api/v1/maps/places-autocomplete
//
// Body: { input: string, sessionToken: string }
// Returns: { predictions: PlacePrediction[] }
//
// Server-side proxy so the Google Maps key never reaches the browser.
import { NextRequest, NextResponse } from "next/server";
import { getAuthContext, unauthorized, badRequest } from "@/lib/api-utils";
import {
  autocompleteAddress,
  PlacesAPIError,
  PlacesConfigError,
} from "@/services/places";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();

  const body = (await req.json().catch(() => ({}))) as {
    input?: string;
    sessionToken?: string;
  };
  if (!body.input || typeof body.input !== "string") {
    return badRequest("input is required");
  }
  if (!body.sessionToken || typeof body.sessionToken !== "string") {
    return badRequest("sessionToken is required");
  }

  try {
    const predictions = await autocompleteAddress({
      text: body.input,
      sessionToken: body.sessionToken,
    });
    return NextResponse.json({ predictions });
  } catch (e) {
    if (e instanceof PlacesConfigError) {
      return NextResponse.json(
        { error: { code: "no_api_key", message: e.message } },
        { status: 503 }
      );
    }
    if (e instanceof PlacesAPIError) {
      return NextResponse.json(
        { error: { code: "upstream", message: e.message } },
        { status: 502 }
      );
    }
    throw e;
  }
}
