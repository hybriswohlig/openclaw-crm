import { NextRequest } from "next/server";
import { badRequest, getAuthContext, success, unauthorized } from "@/lib/api-utils";
import { listCalendarEvents } from "@/services/calendar/load-events";
import { parseCalendarQuery } from "@/services/calendar/query";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized(req);

  const parsed = parseCalendarQuery(req.nextUrl.searchParams);
  if (!parsed.ok) return badRequest(parsed.error);

  const data = await listCalendarEvents(ctx.workspaceId, parsed.query);
  return success(data);
}
