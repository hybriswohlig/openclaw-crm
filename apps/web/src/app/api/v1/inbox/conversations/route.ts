import { NextRequest } from "next/server";
import { getAuthContext, unauthorized, success } from "@/lib/api-utils";
import { listConversations } from "@/services/inbox";

export async function GET(req: NextRequest) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();

  const { searchParams } = new URL(req.url);
  const channelAccountId = searchParams.get("channelAccountId") ?? undefined;
  const operatingCompanyRecordId = searchParams.get("operatingCompanyRecordId") ?? undefined;
  const channelTypeParam = searchParams.get("channelType");
  const channelType =
    channelTypeParam === "email" || channelTypeParam === "whatsapp"
      ? channelTypeParam
      : undefined;
  const status = (searchParams.get("status") ?? "open") as "open" | "resolved" | "spam";
  // KOT-IDENTITY Phase 6: default to the 'lead' lane so ads / newsletters /
  // platform notifications stay out of the inbox unless explicitly requested.
  const lane = (searchParams.get("lane") ?? "lead") as "lead" | "info" | "spam" | "review" | "all";
  const limitParam = searchParams.get("limit");
  const limit = limitParam ? Math.min(Math.max(parseInt(limitParam, 10) || 0, 1), 1000) : undefined;

  const rows = await listConversations(ctx.workspaceId, {
    channelAccountId,
    operatingCompanyRecordId,
    channelType,
    status,
    lane,
    limit,
  });

  return success(rows);
}
