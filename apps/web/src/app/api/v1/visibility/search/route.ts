import { NextRequest } from "next/server";
import { getAuthContext, unauthorized, success } from "@/lib/api-utils";
import { unstable_cache } from "next/cache";
import { getSearchOverview, isSearchSite, type SearchSite } from "@/services/search-insights";

// Search Console aktualisiert einmal täglich; 15 Minuten Zwischenspeicher sind unkritisch.
const cachedSearch = unstable_cache((days: number, site: SearchSite) => getSearchOverview(days, site), ["visibility-search-v2"], { revalidate: 900 });

/** Google-Suche (Search Console) und Besuchshistorie (Plausible + PostHog). */
export async function GET(req: NextRequest) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();

  const daysParam = Number(req.nextUrl.searchParams.get("days") ?? 90);
  const days = [7, 30, 90, 365].includes(daysParam) ? daysParam : 90;
  // Ohne Auswahl ("Alle Websites") zeigt der Reiter Kottke, die Website mit den meisten Suchdaten.
  const siteParam = req.nextUrl.searchParams.get("site") ?? "";
  const site: SearchSite = isSearchSite(siteParam) ? siteParam : "kottke";
  try {
    return success(await cachedSearch(days, site));
  } catch (err) {
    console.error("[visibility] search failed:", err);
    return Response.json({ error: { code: "UPSTREAM", message: "Suchdaten konnten nicht geladen werden." } }, { status: 502 });
  }
}
