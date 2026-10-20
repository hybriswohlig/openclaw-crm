import { NextRequest } from "next/server";
import { getAuthContext, success, unauthorized } from "@/lib/api-utils";
import { calendarFeeds } from "@/services/calendar/feed-token-store";
import { feedPath } from "@/services/calendar/feed-tokens";

export const dynamic = "force-dynamic";

function payload(token: string | null, createdAt: Date | null) {
  return {
    path: token ? feedPath(token) : null,
    createdAt: createdAt ? createdAt.toISOString() : null,
  };
}

export async function GET(req: NextRequest) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized(req);
  const active = await calendarFeeds.getActive(ctx.workspaceId, ctx.userId);
  return success(payload(active?.token ?? null, active?.createdAt ?? null));
}

export async function POST(req: NextRequest) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized(req);
  const row = await calendarFeeds.getOrCreate(ctx.workspaceId, ctx.userId);
  return success(payload(row.token, row.createdAt));
}

export async function DELETE(req: NextRequest) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized(req);
  await calendarFeeds.revokeActive(ctx.workspaceId, ctx.userId);
  return success(payload(null, null));
}
