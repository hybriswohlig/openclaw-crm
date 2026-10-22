import { NextRequest } from "next/server";
import { getAuthContext, unauthorized, success, badRequest } from "@/lib/api-utils";
import { getWorkspace, updateWorkspace } from "@/services/workspace";
import { mergeWorkspaceSettingsUpdate, redactWorkspaceSettings } from "@/lib/workspace-settings";

export async function GET(req: NextRequest) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized(req);

  const workspace = await getWorkspace(ctx.workspaceId);
  return success({
    ...workspace,
    // Every member's browser loads this (sidebar); secrets stay server-side.
    settings: redactWorkspaceSettings(workspace?.settings),
    role: ctx.workspaceRole,
    permissions: ctx.permissions,
    // Effective capability flags — admins implicitly have everything. The UI
    // reads these directly so it doesn't have to OR the role + permissions
    // each time it gates a button.
    capabilities: {
      manageChannels:
        ctx.workspaceRole === "admin" || ctx.permissions?.manageChannels === true,
    },
  });
}

export async function PATCH(req: NextRequest) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized(req);

  if (ctx.workspaceRole !== "admin") {
    return badRequest("Only admins can update workspace settings");
  }

  const body = await req.json();
  // /settings sends back the redacted settings from GET; keep the stored
  // secrets instead of wiping them (they change only via /ai-settings).
  if (body.settings !== undefined) {
    const current = await getWorkspace(ctx.workspaceId);
    body.settings = mergeWorkspaceSettingsUpdate(current?.settings, body.settings);
  }
  const updated = await updateWorkspace(ctx.workspaceId, body);
  return success(updated && { ...updated, settings: redactWorkspaceSettings(updated.settings) });
}
