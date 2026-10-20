import { NextRequest } from "next/server";
import { getAuthContext, unauthorized, success } from "@/lib/api-utils";
import { markAllAsRead } from "@/services/notifications";

export async function POST(req: NextRequest) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized(req);

  await markAllAsRead(ctx.workspaceId, ctx.userId);
  return success({ ok: true });
}
