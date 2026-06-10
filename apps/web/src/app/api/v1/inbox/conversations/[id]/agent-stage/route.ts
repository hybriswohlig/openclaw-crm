import { NextRequest, NextResponse } from "next/server";
import { getAuthContext, unauthorized, success } from "@/lib/api-utils";
import { setConversationAgentStage } from "@/services/inbox";
import type { AgentStage } from "@/db/schema/inbox";

const VALID_STAGES: AgentStage[] = [
  "erstkontakt",
  "infos_erhalten",
  "angebot_raus",
  "angenommen",
  "verloren",
];

/**
 * Manually set the agent funnel stage (inbox badge) for a conversation.
 * Not admin-gated: whoever works the inbox can correct a stale stage.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();

  const { id } = await params;
  const { stage } = await req.json();
  if (typeof stage !== "string" || !VALID_STAGES.includes(stage as AgentStage)) {
    return NextResponse.json({ error: "invalid stage" }, { status: 400 });
  }

  const row = await setConversationAgentStage(id, ctx.workspaceId, stage as AgentStage);
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return success(row);
}
