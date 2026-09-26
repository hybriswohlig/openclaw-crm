import { NextRequest } from "next/server";
import { getAuthContext, unauthorized, success } from "@/lib/api-utils";
import { unstable_cache } from "next/cache";
import { getSearchOverview } from "@/services/search-insights";

// Search Console aktualisiert einmal täglich; 15 Minuten Zwischenspeicher sind unkritisch.
const cachedSearch = unstable_cache((days: number) => getSearchOverview(days), ["visibility-search-v1"], { revalidate: 900 });

/** Google-Suche (Search Console) und Besuchshistorie (Plausible + PostHog). */
export async function GET(req: NextRequest) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();

  const daysParam = Number(req.nextUrl.searchParams.get("days") ?? 90);
  const days = [7, 30, 90, 365].includes(daysParam) ? daysParam : 90;
  try {
    return success(await cachedSearch(days));
  } catch (err) {
    console.error("[visibility] search failed:", err);
    return Response.json({ error: { code: "UPSTREAM", message: "Suchdaten konnten nicht geladen werden." } }, { status: 502 });
  }
}
