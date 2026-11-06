import { NextRequest } from "next/server";
import { getAuthContext, success, unauthorized } from "@/lib/api-utils";
import { ladeNavZaehler } from "@/services/heute";

/**
 * GET → `{ data: NavZaehler }` (Plan 8, Entscheidung 12): „Heute“ = Chip
 * „warten auf uns“, „Leads“ = offene Leads. Liest nur.
 */
export async function GET(req: NextRequest) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized(req);
  return success(await ladeNavZaehler(ctx.workspaceId));
}
