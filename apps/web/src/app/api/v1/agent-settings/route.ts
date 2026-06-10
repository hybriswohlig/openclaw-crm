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
    firstContactEnabled?: unknown;
    firstContactChannelAccountId?: unknown;
    firstContactTemplate?: unknown;
    firstContactTemplateParams?: unknown;
    firstContactDailyCap?: unknown;
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
    firstContactEnabled?: boolean;
    firstContactChannelAccountId?: string | null;
    firstContactTemplate?: string;
    firstContactTemplateParams?: string;
    firstContactDailyCap?: number;
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
  if (body.firstContactEnabled !== undefined) {
    if (typeof body.firstContactEnabled !== "boolean")
      return NextResponse.json({ error: "firstContactEnabled must be boolean" }, { status: 400 });
    patch.firstContactEnabled = body.firstContactEnabled;
  }
  if (body.firstContactChannelAccountId !== undefined) {
    if (body.firstContactChannelAccountId !== null && typeof body.firstContactChannelAccountId !== "string")
      return NextResponse.json(
        { error: "firstContactChannelAccountId must be string or null" },
        { status: 400 }
      );
    patch.firstContactChannelAccountId = body.firstContactChannelAccountId;
  }
  if (body.firstContactTemplate !== undefined) {
    if (typeof body.firstContactTemplate !== "string")
      return NextResponse.json({ error: "firstContactTemplate must be string" }, { status: 400 });
    patch.firstContactTemplate = body.firstContactTemplate;
  }
  if (body.firstContactTemplateParams !== undefined) {
    if (typeof body.firstContactTemplateParams !== "string")
      return NextResponse.json(
        { error: "firstContactTemplateParams must be string" },
        { status: 400 }
      );
    patch.firstContactTemplateParams = body.firstContactTemplateParams;
  }
  if (body.firstContactDailyCap !== undefined) {
    if (typeof body.firstContactDailyCap !== "number" || !Number.isFinite(body.firstContactDailyCap))
      return NextResponse.json({ error: "firstContactDailyCap must be a number" }, { status: 400 });
    patch.firstContactDailyCap = body.firstContactDailyCap;
  }

  return success(await setAgentSettings(ctx.workspaceId, patch));
}
