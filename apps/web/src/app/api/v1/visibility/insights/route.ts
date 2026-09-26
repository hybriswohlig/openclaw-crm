import { NextRequest } from "next/server";
import { getAuthContext, unauthorized, success } from "@/lib/api-utils";
import { unstable_cache } from "next/cache";
import { getChannelLedger, getFindings, getSectionBand, knownSite } from "@/services/website-insights";

const cachedInsights = unstable_cache(
  async (workspaceId: string, days: number, site: string | null) => {
    const [ledger, band] = await Promise.all([getChannelLedger(workspaceId, days, site), getSectionBand(days, site, "/")]);
    const { findings, zuWenig, periode } = await getFindings(days, site, ledger, band);
    return { configured: true, days, site, ledger, findings, zuWenig, periode };
  },
  ["visibility-insights-v1"],
  { revalidate: 120 }
);
import { isPosthogConfigured } from "@/services/website-analytics";

/** Befunde + Kasse pro Kanal für den Überblick auf /sichtbarkeit. */
export async function GET(req: NextRequest) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();

  const daysParam = Number(req.nextUrl.searchParams.get("days") ?? 30);
  const days = [7, 30, 90, 365].includes(daysParam) ? daysParam : 30;
  const site = knownSite(req.nextUrl.searchParams.get("site"));
  if (!isPosthogConfigured()) return success({ configured: false });

  try {
    return success(await cachedInsights(ctx.workspaceId, days, site));
  } catch (err) {
    console.error("[visibility] insights failed:", err);
    return Response.json({ error: { code: "UPSTREAM", message: "Daten konnten nicht geladen werden." } }, { status: 502 });
  }
}
