import { NextRequest, NextResponse } from "next/server";
import { getAuthContext, unauthorized, success } from "@/lib/api-utils";
import { getWorkDashboard } from "@/services/work-dashboard";

export const dynamic = "force-dynamic";

/** GET /api/v1/work/dashboard — the whole dashboard in ONE call (spec §10). */
export async function GET(req: NextRequest) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();
  try {
    const sprintId = req.nextUrl.searchParams.get("sprintId") || undefined;
    return success(await getWorkDashboard(ctx.workspaceId, ctx.userId, sprintId));
  } catch (err) {
    console.error("GET work dashboard error:", err);
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: String(err) } },
      { status: 500 },
    );
  }
}
