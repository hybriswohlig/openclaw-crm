import { NextRequest } from "next/server";
import { getAuthContext, unauthorized, success } from "@/lib/api-utils";
import { getChannelLedger, getFindings, getSectionBand, knownSite } from "@/services/website-insights";
import { isPosthogConfigured } from "@/services/website-analytics";

/** Befunde + Kasse pro Kanal für den Überblick auf /sichtbarkeit. */
export async function GET(req: NextRequest) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();

  const daysParam = Number(req.nextUrl.searchParams.get("days") ?? 30);
  const days = [7, 30, 90].includes(daysParam) ? daysParam : 30;
  const site = knownSite(req.nextUrl.searchParams.get("site"));
  if (!isPosthogConfigured()) return success({ configured: false });

  try {
    const [ledger, band] = await Promise.all([
      getChannelLedger(ctx.workspaceId, days, site),
      getSectionBand(days, site, "/"),
    ]);
    const { findings, zuWenig, periode } = await getFindings(days, site, ledger, band);
    return success({ configured: true, days, site, ledger, findings, zuWenig, periode });
  } catch (err) {
    console.error("[visibility] insights failed:", err);
    return Response.json({ error: { code: "UPSTREAM", message: "Daten konnten nicht geladen werden." } }, { status: 502 });
  }
}
