import { NextRequest } from "next/server";
import { getAuthContext, unauthorized, success } from "@/lib/api-utils";
import { listConversations } from "@/services/inbox";

export async function GET(req: NextRequest) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();

  const { searchParams } = new URL(req.url);
  const channelAccountId = searchParams.get("channelAccountId") ?? undefined;
  const operatingCompanyRecordId = searchParams.get("operatingCompanyRecordId") ?? undefined;
  const status = (searchParams.get("status") ?? "open") as "open" | "resolved" | "spam";
  const limitParam = searchParams.get("limit");
  const limit = limitParam ? Math.min(Math.max(parseInt(limitParam, 10) || 0, 1), 1000) : undefined;

  const rows = await listConversations(ctx.workspaceId, {
    channelAccountId,
    operatingCompanyRecordId,
    status,
    limit,
  });

  return success(rows);
}
