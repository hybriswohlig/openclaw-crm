import { NextRequest, NextResponse } from "next/server";
import { getAuthContext, unauthorized, success, requireAdmin } from "@/lib/api-utils";
import {
  getIntegrationById,
  updateIntegration,
  deleteIntegration,
} from "@/services/integrations";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();

  const { id } = await params;
  const row = await getIntegrationById(ctx.workspaceId, id);
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Members don't see API keys
  if (ctx.workspaceRole !== "admin") {
    const { apiKey: _k, ...rest } = row;
    return success(rest);
  }

  return success(row);
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();
  const deny = requireAdmin(ctx);
  if (deny) return deny;

  const { id } = await params;
  const body = await req.json();

  const {
    name,
    description,
    logoSvg,
    logoUrl,
    status,
    apiKey,
    webhookUrl,
    syncRules,
    position,
  } = body;

  const validStatuses = ["coming_soon", "active", "inactive"];
  if (status !== undefined && !validStatuses.includes(status)) {
    return NextResponse.json({ error: "Invalid status" }, { status: 400 });
  }

  const updated = await updateIntegration(ctx.workspaceId, id, {
    name,
    description,
    logoSvg,
    logoUrl,
    status,
    apiKey,
    webhookUrl,
    syncRules:
      syncRules !== undefined
        ? syncRules === null
          ? null
          : typeof syncRules === "string"
            ? syncRules
            : JSON.stringify(syncRules)
        : undefined,
    position,
  });

  if (!updated) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return success(updated);
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();
  const deny = requireAdmin(ctx);
  if (deny) return deny;

  const { id } = await params;
  const deleted = await deleteIntegration(ctx.workspaceId, id);

  if (!deleted) {
    return NextResponse.json(
      { error: "Not found or cannot delete built-in integrations" },
      { status: 404 }
    );
  }

  return NextResponse.json({ success: true });
}
