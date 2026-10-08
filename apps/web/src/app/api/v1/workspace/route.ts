import { NextRequest } from "next/server";
import { getAuthContext, unauthorized, success, badRequest } from "@/lib/api-utils";
import { getWorkspace, updateWorkspace } from "@/services/workspace";
import { toPublicWorkspace } from "@/lib/workspace-secrets";

export async function GET(req: NextRequest) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();

  const workspace = await getWorkspace(ctx.workspaceId);
  return success({
    // Geht an jedes Mitglied (Seitenleiste, crm_whoami): Einstellungen ohne
    // geheime Felder wie den OpenRouter-Schlüssel, dafür hasOpenrouterKey.
    ...(workspace ? toPublicWorkspace(workspace) : {}),
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
  if (!ctx) return unauthorized();

  if (ctx.workspaceRole !== "admin") {
    return badRequest("Only admins can update workspace settings");
  }

  const body = await req.json();
  const settings: unknown = body?.settings;
  if (
    settings !== undefined &&
    (typeof settings !== "object" || settings === null || Array.isArray(settings))
  ) {
    return badRequest("settings must be an object");
  }

  // updateWorkspace behält gespeicherte Geheimnisse, die der Client nicht
  // kennt und deshalb nicht mitschickt.
  const updated = await updateWorkspace(ctx.workspaceId, body);
  return success(updated ? toPublicWorkspace(updated) : updated);
}
