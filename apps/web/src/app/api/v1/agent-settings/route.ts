import { NextRequest, NextResponse } from "next/server";
import { getAuthContext, unauthorized, requireAdmin, success } from "@/lib/api-utils";
import { getAgentSettings, setAgentSettings } from "@/services/agent/agent-config";

/** Read the sales agent control state (master switch, dry-run, channels, signature). */
export async function GET(req: NextRequest) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();
  const gate = requireAdmin(ctx);
  if (gate) return gate;
  return success(await getAgentSettings(ctx.workspaceId));
}

/** Update the sales agent control state. Admin only. */
export async function PATCH(req: NextRequest) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();
  const gate = requireAdmin(ctx);
  if (gate) return gate;

  const body = (await req.json()) as {
    enabled?: unknown;
    dryRun?: unknown;
    channels?: unknown;
    signature?: unknown;
    followupEnabled?: unknown;
    discloseAi?: unknown;
    disclosure?: unknown;
    handoffAck?: unknown;
  };

  const patch: {
    enabled?: boolean;
    dryRun?: boolean;
    channels?: string[];
    signature?: string;
    followupEnabled?: boolean;
    discloseAi?: boolean;
    disclosure?: string;
    handoffAck?: string;
  } = {};
  if (body.enabled !== undefined) {
    if (typeof body.enabled !== "boolean")
      return NextResponse.json({ error: "enabled must be boolean" }, { status: 400 });
    patch.enabled = body.enabled;
  }
  if (body.dryRun !== undefined) {
    if (typeof body.dryRun !== "boolean")
      return NextResponse.json({ error: "dryRun must be boolean" }, { status: 400 });
    patch.dryRun = body.dryRun;
  }
  if (body.followupEnabled !== undefined) {
    if (typeof body.followupEnabled !== "boolean")
      return NextResponse.json({ error: "followupEnabled must be boolean" }, { status: 400 });
    patch.followupEnabled = body.followupEnabled;
  }
  if (body.discloseAi !== undefined) {
    if (typeof body.discloseAi !== "boolean")
      return NextResponse.json({ error: "discloseAi must be boolean" }, { status: 400 });
    patch.discloseAi = body.discloseAi;
  }
  if (body.channels !== undefined) {
    if (!Array.isArray(body.channels) || body.channels.some((c) => typeof c !== "string"))
      return NextResponse.json({ error: "channels must be string[]" }, { status: 400 });
    patch.channels = body.channels as string[];
  }
  if (body.signature !== undefined) {
    if (typeof body.signature !== "string")
      return NextResponse.json({ error: "signature must be string" }, { status: 400 });
    patch.signature = body.signature;
  }
  if (body.disclosure !== undefined) {
    if (typeof body.disclosure !== "string")
      return NextResponse.json({ error: "disclosure must be string" }, { status: 400 });
    patch.disclosure = body.disclosure;
  }
  if (body.handoffAck !== undefined) {
    if (typeof body.handoffAck !== "string")
      return NextResponse.json({ error: "handoffAck must be string" }, { status: 400 });
    patch.handoffAck = body.handoffAck;
  }

  return success(await setAgentSettings(ctx.workspaceId, patch));
}
