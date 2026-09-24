import { NextRequest } from "next/server";
import { getAuthContext, unauthorized, success } from "@/lib/api-utils";
import { getVisibilityOverview, WEBSITES } from "@/services/website-analytics";

export async function GET(req: NextRequest) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();

  const daysParam = Number(req.nextUrl.searchParams.get("days") ?? 30);
  const days = [7, 30, 90].includes(daysParam) ? daysParam : 30;
  const siteParam = req.nextUrl.searchParams.get("site");
  const site = WEBSITES.some((w) => w.site === siteParam) ? siteParam : null;

  try {
    return success(await getVisibilityOverview(days, site));
  } catch (err) {
    console.error("[visibility] overview failed:", err);
    return Response.json(
      { error: { code: "UPSTREAM", message: "PostHog-Daten konnten nicht geladen werden." } },
      { status: 502 }
    );
  }
}
