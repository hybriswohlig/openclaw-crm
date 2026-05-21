// Streams a Google Street View image for a given address.
//
// Why a proxy instead of the browser hitting Google directly?
//   1) Keeps GOOGLE_MAPS_API_KEY server-side.
//   2) Lets us cache + return a 1×1 placeholder for ZERO_RESULTS so the UI
//      doesn't render a broken image.
//
// Query params:
//   address (required) — full address string, e.g. "Heilbronner Str. 339, 70469 Stuttgart"
//   width, height, fov, heading, pitch — optional, see services/street-view.ts
//
// Response: image/jpeg with Cache-Control: private, max-age=86400
// (Street View imagery is stable enough for a one-day cache.)

import { NextRequest, NextResponse } from "next/server";
import { getAuthContext, unauthorized, badRequest } from "@/lib/api-utils";
import {
  fetchStreetView,
  StreetViewConfigError,
  StreetViewAPIError,
} from "@/services/street-view";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();

  const sp = req.nextUrl.searchParams;
  const address = sp.get("address");
  if (!address) return badRequest("address is required");

  const optNum = (key: string): number | undefined => {
    const v = sp.get(key);
    if (v == null) return undefined;
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  };

  try {
    const result = await fetchStreetView({
      address,
      width: optNum("width") ?? 600,
      height: optNum("height") ?? 400,
      fov: optNum("fov"),
      heading: optNum("heading"),
      pitch: optNum("pitch"),
    });

    if (!result) {
      // 204 No Content + custom header so the UI can show a neutral
      // placeholder rather than rendering a broken image.
      return new NextResponse(null, {
        status: 204,
        headers: { "X-StreetView-Status": "ZERO_RESULTS" },
      });
    }

    return new NextResponse(new Uint8Array(result.bytes), {
      status: 200,
      headers: {
        "Content-Type": result.mime,
        "Content-Length": String(result.bytes.length),
        "Cache-Control": "private, max-age=86400",
      },
    });
  } catch (e) {
    if (e instanceof StreetViewConfigError) {
      return NextResponse.json(
        { error: e.message, code: "no_api_key" },
        { status: 503 }
      );
    }
    if (e instanceof StreetViewAPIError) {
      return NextResponse.json(
        { error: e.message, code: "upstream" },
        { status: 502 }
      );
    }
    throw e;
  }
}
