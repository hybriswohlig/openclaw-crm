import { NextRequest } from "next/server";
import { getAuthContext, unauthorized, success } from "@/lib/api-utils";
import { parseFilters } from "@/services/website-analytics";
import { knownSite } from "@/services/website-insights";
import { getVisitorSessions } from "@/services/visitor-sessions";

/** Einzelne Besuche, gefiltert wie der Analyse-Reiter, mit zugeordnetem Lead. */
export async function GET(req: NextRequest) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();
  const p = req.nextUrl.searchParams;
  const daysParam = Number(p.get("days") ?? 30);
  const days = [7, 30, 90, 365].includes(daysParam) ? daysParam : 30;
  try {
    return success(await getVisitorSessions(ctx.workspaceId, days, knownSite(p.get("site")), parseFilters(p)));
  } catch (err) {
    console.error("[visibility] sessions failed:", err);
    return Response.json({ error: { code: "UPSTREAM", message: "Besuche konnten nicht geladen werden." } }, { status: 502 });
  }
}
