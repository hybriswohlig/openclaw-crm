import { NextRequest } from "next/server";
import { and, desc, eq, notInArray } from "drizzle-orm";
import { getAuthContext, success, unauthorized } from "@/lib/api-utils";
import { db } from "@/db";
import { activityEvents } from "@/db/schema/activity";
import { ALT_AUFRUF_EVENT, QUOTATION_ZAEHL_EVENT } from "@/lib/dunkel-abschaltung";

export const dynamic = "force-dynamic";

/**
 * Workspace-wide activity feed for the Home page. Returns the latest
 * activity events across every record, newest first.
 */
export async function GET(req: NextRequest) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized(req);

  const limit = Math.min(
    Number(req.nextUrl.searchParams.get("limit") ?? 6),
    50
  );

  const rows = await db
    .select()
    .from(activityEvents)
    .where(
      and(
        eq(activityEvents.workspaceId, ctx.workspaceId),
        // Plan 14: Zählungen (PUT /quotation, alte Seiten) sind keine Aktivität für die Startseite.
        notInArray(activityEvents.eventType, [QUOTATION_ZAEHL_EVENT, ALT_AUFRUF_EVENT])
      )
    )
    .orderBy(desc(activityEvents.createdAt))
    .limit(limit);

  return success(rows);
}
