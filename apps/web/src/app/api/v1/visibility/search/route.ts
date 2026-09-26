import { NextRequest } from "next/server";
import { getAuthContext, unauthorized, success } from "@/lib/api-utils";
import { getSearchOverview } from "@/services/search-insights";

/** Google-Suche (Search Console) und Besuchshistorie (Plausible + PostHog). */
export async function GET(req: NextRequest) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();

  const daysParam = Number(req.nextUrl.searchParams.get("days") ?? 90);
  const days = [7, 30, 90].includes(daysParam) ? daysParam : 90;
  try {
    return success(await getSearchOverview(days));
  } catch (err) {
    console.error("[visibility] search failed:", err);
    return Response.json({ error: { code: "UPSTREAM", message: "Suchdaten konnten nicht geladen werden." } }, { status: 502 });
  }
}
