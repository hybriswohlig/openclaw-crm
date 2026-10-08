import { NextRequest } from "next/server";
import { getAuthContext, success, unauthorized } from "@/lib/api-utils";
import { ladeLagekarte } from "@/services/lagekarte";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/lagekarte: gebündelte Lage für die Startseiten-Karte (Leads,
 * Firmen, Stufen, Kennzahlen, Missionen). Rein lesend, ohne Seiteneffekte.
 */
export async function GET(req: NextRequest) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();

  return success(await ladeLagekarte(ctx.workspaceId));
}
