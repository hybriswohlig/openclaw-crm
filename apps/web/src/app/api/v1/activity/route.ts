import { NextRequest } from "next/server";
import { desc, eq } from "drizzle-orm";
import { getAuthContext, success, unauthorized } from "@/lib/api-utils";
import { db } from "@/db";
import { activityEvents } from "@/db/schema/activity";

export const dynamic = "force-dynamic";

/**
 * Workspace-wide activity feed for the Home page. Returns the latest
 * activity events across every record, newest first.
 */
export async function GET(req: NextRequest) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();

  const limit = Math.min(
    Number(req.nextUrl.searchParams.get("limit") ?? 6),
    50
  );

  const rows = await db
    .select()
    .from(activityEvents)
    .where(eq(activityEvents.workspaceId, ctx.workspaceId))
    .orderBy(desc(activityEvents.createdAt))
    .limit(limit);

  return success(rows);
}
