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

  const rows = await listConversations(ctx.workspaceId, {
    channelAccountId,
    operatingCompanyRecordId,
    status,
  });

  return success(rows);
}
