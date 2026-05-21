// GET /api/v1/maps/places-detail?placeId=...&sessionToken=...
// Returns: { location: PlaceLocation }
import { NextRequest, NextResponse } from "next/server";
import { getAuthContext, unauthorized, badRequest, notFound } from "@/lib/api-utils";
import {
  placeDetail,
  PlacesAPIError,
  PlacesConfigError,
} from "@/services/places";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();

  const placeId = req.nextUrl.searchParams.get("placeId");
  const sessionToken = req.nextUrl.searchParams.get("sessionToken");
  if (!placeId) return badRequest("placeId is required");
  if (!sessionToken) return badRequest("sessionToken is required");

  try {
    const location = await placeDetail({ placeId, sessionToken });
    if (!location) return notFound("place not found");
    return NextResponse.json({ location });
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
