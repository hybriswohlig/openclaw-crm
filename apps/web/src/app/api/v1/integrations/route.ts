import { NextRequest, NextResponse } from "next/server";
import { getAuthContext, unauthorized, success, requireAdmin } from "@/lib/api-utils";
import {
  getIntegrations,
  createIntegration,
} from "@/services/integrations";

export async function GET(req: NextRequest) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();

  const rows = await getIntegrations(ctx.workspaceId);

  // Members see everything except API keys
  if (ctx.workspaceRole !== "admin") {
    return success(rows.map(({ apiKey: _k, ...rest }) => rest));
  }

  return success(rows);
}

export async function POST(req: NextRequest) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();
  const deny = requireAdmin(ctx);
  if (deny) return deny;

  const body = await req.json();
  const { slug, name, description, logoSvg, logoUrl, type, apiKey, webhookUrl, syncRules, position } = body;

  if (!slug || !name || !type) {
    return NextResponse.json({ error: "slug, name and type are required" }, { status: 400 });
  }

  const validTypes = ["built_in", "zapier", "custom"];
  if (!validTypes.includes(type)) {
    return NextResponse.json({ error: "Invalid type" }, { status: 400 });
  }

  const row = await createIntegration(ctx.workspaceId, {
    slug,
    name,
    description,
    logoSvg,
    logoUrl,
    type,
    apiKey,
    webhookUrl,
    syncRules: syncRules ? JSON.stringify(syncRules) : undefined,
    position: position ?? 99,
  });

  return success(row);
}
