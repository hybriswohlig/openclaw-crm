import { NextRequest } from "next/server";
import { getAuthContext, unauthorized, success } from "@/lib/api-utils";
import { unstable_cache } from "next/cache";
import { getVisibilityOverview, parseFilters, WEBSITES, type VisibilityFilters } from "@/services/website-analytics";

// PostHog-Abfragen dauern mehrere Sekunden; 5 Minuten Zwischenspeicher reichen für ein Dashboard.
const cachedOverview = unstable_cache(
  (days: number, site: string | null, filters: VisibilityFilters) => getVisibilityOverview(days, site, filters),
  ["visibility-overview-v2"],
  { revalidate: 300 }
);

export async function GET(req: NextRequest) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();

  const daysParam = Number(req.nextUrl.searchParams.get("days") ?? 30);
  const days = [7, 30, 90, 365].includes(daysParam) ? daysParam : 30;
  const siteParam = req.nextUrl.searchParams.get("site");
  const site = WEBSITES.some((w) => w.site === siteParam) ? siteParam : null;

  try {
    return success(await cachedOverview(days, site, parseFilters(req.nextUrl.searchParams)));
  } catch (err) {
    console.error("[visibility] overview failed:", err);
    return Response.json(
      { error: { code: "UPSTREAM", message: "PostHog-Daten konnten nicht geladen werden." } },
      { status: 502 }
    );
  }
}
