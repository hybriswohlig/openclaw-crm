import { NextRequest } from "next/server";
import { getAuthContext, success, unauthorized } from "@/lib/api-utils";
import { calendarFeeds } from "@/services/calendar/feed-token-store";
import { feedPath } from "@/services/calendar/feed-tokens";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized(req);
  const row = await calendarFeeds.regenerate(ctx.workspaceId, ctx.userId);
  return success({
    path: feedPath(row.token),
    createdAt: row.createdAt.toISOString(),
  });
}
