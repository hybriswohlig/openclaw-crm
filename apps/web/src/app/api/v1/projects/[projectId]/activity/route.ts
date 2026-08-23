import { NextRequest, NextResponse } from "next/server";
import { getAuthContext, unauthorized, success } from "@/lib/api-utils";
import { listProjectActivity } from "@/services/work-dashboard";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/projects/[projectId]/activity
 *
 * Returns `{ id, type, title, description, createdAt, actorName }[]` — the
 * SAME element shape as `DashboardPayload.activity` (HTTP wire contract),
 * produced by the same `toActivityFeedEntries` fold.
 *
 * It must NOT return raw `activity_events` rows: those carry `eventType` /
 * `payload`, the UI reads `type` / `title` and switches on `type`, and every
 * project has a `project.created` row — so a pass-through crashed the
 * default tab of every project detail page.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();
  const { projectId } = await params;

  try {
    const raw = Number(req.nextUrl.searchParams.get("limit") ?? 50);
    const limit = Number.isFinite(raw) ? Math.min(Math.max(raw, 1), 200) : 50;
    return success(await listProjectActivity(ctx.workspaceId, projectId, limit));
  } catch (err) {
    console.error("GET project activity error:", err);
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: String(err) } },
      { status: 500 },
    );
  }
}
