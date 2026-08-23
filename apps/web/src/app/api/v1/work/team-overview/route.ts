import { NextRequest, NextResponse } from "next/server";
import { getAuthContext, unauthorized, success } from "@/lib/api-utils";
import { getTeamOverview } from "@/services/work-dashboard";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();
  try {
    const sprintId = req.nextUrl.searchParams.get("sprintId") || undefined;
    return success(await getTeamOverview(ctx.workspaceId, sprintId));
  } catch (err) {
    console.error("GET team overview error:", err);
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: String(err) } },
      { status: 500 },
    );
  }
}
