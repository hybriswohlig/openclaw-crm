import { NextRequest, NextResponse } from "next/server";
import { getAuthContext, unauthorized, requireAdmin, success } from "@/lib/api-utils";
import { getSetting, setSetting } from "@/services/workspace-settings";

/**
 * Master switch for the automatic customer-portal status notifications
 * (WhatsApp-first, email fallback). Stored in workspace_settings; unset
 * reads as OFF so deploys never start sending on their own.
 */
const KEY_ENABLED = "portal_notifications_enabled";

/** Read the portal notification switch. Admin only. */
export async function GET(req: NextRequest) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();
  const gate = requireAdmin(ctx);
  if (gate) return gate;

  const enabled = (await getSetting(ctx.workspaceId, KEY_ENABLED)) === "true";
  return success({ enabled });
}

/** Update the portal notification switch. Admin only. */
export async function PATCH(req: NextRequest) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();
  const gate = requireAdmin(ctx);
  if (gate) return gate;

  const body = (await req.json()) as { enabled?: unknown };
  if (typeof body.enabled !== "boolean") {
    return NextResponse.json({ error: "enabled must be boolean" }, { status: 400 });
  }

  await setSetting(ctx.workspaceId, KEY_ENABLED, body.enabled ? "true" : "false");
  return success({ enabled: body.enabled });
}
