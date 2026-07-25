import { NextRequest, NextResponse } from "next/server";
import { getAuthContext, unauthorized, success } from "@/lib/api-utils";
import { releaseHumanOwnership } from "@/services/agent/agent-gate";

/**
 * Explicit release of sticky human ownership — the ONLY path that hands a
 * deal back to the sales agent (never silence, never a cron;
 * docs/ai-sales-agent-plan.md).
 */
export async function POST(req: NextRequest) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();

  const body = (await req.json().catch(() => null)) as {
    dealRecordId?: unknown;
  } | null;
  if (!body || typeof body.dealRecordId !== "string" || !body.dealRecordId) {
    return NextResponse.json({ error: "dealRecordId is required" }, { status: 400 });
  }

  await releaseHumanOwnership(ctx.workspaceId, body.dealRecordId);
  return success({ released: true });
}
