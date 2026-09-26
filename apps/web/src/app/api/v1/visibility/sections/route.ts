import { NextRequest } from "next/server";
import { getAuthContext, unauthorized, success } from "@/lib/api-utils";
import { unstable_cache } from "next/cache";
import { getSectionBand, knownSite } from "@/services/website-insights";

const cachedBand = unstable_cache((days: number, site: string | null, page: string) => getSectionBand(days, site, page), ["visibility-sections-v1"], {
  revalidate: 300,
});

/** Röntgen-Streifen: Abschnitte einer Seite in Seitenreihenfolge. */
export async function GET(req: NextRequest) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();

  const daysParam = Number(req.nextUrl.searchParams.get("days") ?? 30);
  const days = [7, 30, 90, 365].includes(daysParam) ? daysParam : 30;
  const site = knownSite(req.nextUrl.searchParams.get("site"));
  const page = (req.nextUrl.searchParams.get("page") ?? "/").slice(0, 300) || "/";

  try {
    return success(await cachedBand(days, site, page));
  } catch (err) {
    console.error("[visibility] sections failed:", err);
    return Response.json({ error: { code: "UPSTREAM", message: "Daten konnten nicht geladen werden." } }, { status: 502 });
  }
}
