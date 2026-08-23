import { NextRequest, NextResponse } from "next/server";
import { getAuthContext, unauthorized, success } from "@/lib/api-utils";
import { getSprintTimeline } from "@/services/work-dashboard";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/work/timeline
 *   ?sprintId=       — sprint mode (default: the active sprint)
 *   ?projectId=      — project mode: every task of that project, sprint or
 *                      not, windowed on the project's own dates
 *   ?maxBarsPerRow=  — raise the default cap of 12 (the project Zeitleiste
 *                      tab asks for 40); the row reports truncatedBars.
 */
export async function GET(req: NextRequest) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();
  try {
    const params = req.nextUrl.searchParams;
    const maxBars = Number(params.get("maxBarsPerRow"));
    return success(
      await getSprintTimeline(ctx.workspaceId, {
        sprintId: params.get("sprintId") || undefined,
        projectId: params.get("projectId") || undefined,
        maxBarsPerRow:
          Number.isFinite(maxBars) && maxBars > 0 ? Math.min(maxBars, 100) : undefined,
      }),
    );
  } catch (err) {
    console.error("GET work timeline error:", err);
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: String(err) } },
      { status: 500 },
    );
  }
}
