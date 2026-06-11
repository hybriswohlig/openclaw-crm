import { NextRequest } from "next/server";
import { getAuthContext, unauthorized, success } from "@/lib/api-utils";
import { db } from "@/db";
import { inboxConversations } from "@/db/schema/inbox";
import { and, eq, sql } from "drizzle-orm";

export async function GET(req: NextRequest) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();

  const [row] = await db
    .select({
      unreadCount: sql<number>`coalesce(sum(${inboxConversations.unreadCount}), 0)::int`,
    })
    .from(inboxConversations)
    .where(
      and(
        eq(inboxConversations.workspaceId, ctx.workspaceId),
        eq(inboxConversations.status, "open"),
        eq(inboxConversations.lane, "lead")
      )
    );

  return success({ unreadCount: Number(row?.unreadCount ?? 0) });
}
