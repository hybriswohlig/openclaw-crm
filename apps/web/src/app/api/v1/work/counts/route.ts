import { NextRequest, NextResponse } from "next/server";
import { getAuthContext, unauthorized, success } from "@/lib/api-utils";
import { getWorkCounts } from "@/services/work-dashboard";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/work/counts — the KPI integers only.
 *
 * `/home` needs two numbers, not the whole dashboard. `/dashboard` runs three
 * `listProjects` (one enriching up to 200 projects with members, favourites
 * and a five-query stats fold), four `listTasks`, the activity query,
 * `listMembers`, `getTeamOverview` and the milestone/phase/move queries —
 * about 30 round trips. This is ~7 aggregates and no enrichment at all.
 *
 * Every figure is a true count(*), never a page length. `dueTodayCount`
 * covers ALL kinds; `operativeDueTodayCount` is scoped `kind='operativ'` —
 * both are present because /home was adding one to the other.
 */
export async function GET(req: NextRequest) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();
  try {
    const sprintId = req.nextUrl.searchParams.get("sprintId") || undefined;
    return success(await getWorkCounts(ctx.workspaceId, sprintId));
  } catch (err) {
    console.error("GET work counts error:", err);
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: String(err) } },
      { status: 500 },
    );
  }
}
