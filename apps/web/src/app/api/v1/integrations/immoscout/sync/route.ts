import { NextRequest, NextResponse } from "next/server";
import { getAuthContext, unauthorized, requireAdmin, success, badRequest } from "@/lib/api-utils";
import { getIntegrations } from "@/services/integrations";
import { syncImmoscoutLeads } from "@/services/immoscout-sync";

export async function POST(req: NextRequest) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();
  const deny = requireAdmin(ctx);
  if (deny) return deny;

  // Find the ImmobilienScout24 integration for this workspace
  const allIntegrations = await getIntegrations(ctx.workspaceId);
  const immoscout = allIntegrations.find((i) => i.slug === "immobilienscout24");

  if (!immoscout) {
    return badRequest("ImmobilienScout24 integration not found");
  }

  if (immoscout.status !== "active") {
    return badRequest("ImmobilienScout24 integration is not active. Please activate it first.");
  }

  if (!immoscout.apiKey) {
    return badRequest("No API key configured for ImmobilienScout24. Please add your umzug-easy API token.");
  }

  const result = await syncImmoscoutLeads(ctx.workspaceId, immoscout.apiKey);

  return success(result);
}
