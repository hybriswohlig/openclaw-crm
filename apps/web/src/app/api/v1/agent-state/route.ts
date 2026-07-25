import { NextRequest, NextResponse } from "next/server";
import { getAuthContext, unauthorized, success } from "@/lib/api-utils";
import { db } from "@/db";
import { dealAgentState } from "@/db/schema/agent";
import { and, eq } from "drizzle-orm";

/**
 * Read the sticky human-ownership flag for one deal
 * (docs/ai-sales-agent-plan.md). A missing deal_agent_state row means the
 * agent has never been muted here → humanOwned=false.
 */
export async function GET(req: NextRequest) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();

  const dealRecordId = req.nextUrl.searchParams.get("dealRecordId");
  if (!dealRecordId) {
    return NextResponse.json({ error: "dealRecordId is required" }, { status: 400 });
  }

  const [row] = await db
    .select({ humanOwned: dealAgentState.humanOwned })
    .from(dealAgentState)
    .where(
      and(
        eq(dealAgentState.dealRecordId, dealRecordId),
        eq(dealAgentState.workspaceId, ctx.workspaceId)
      )
    )
    .limit(1);

  return success({ humanOwned: row?.humanOwned ?? false });
}
