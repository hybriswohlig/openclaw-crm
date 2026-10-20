import { NextRequest, NextResponse } from "next/server";
import { getAuthContext, unauthorized, badRequest, success, requireAdmin } from "@/lib/api-utils";
import { API_KEY_FULL_SCOPES } from "@/lib/api-key-scopes";
import { createApiKey, listApiKeys } from "@/services/api-keys";

/** GET /api/v1/api-keys — List all API keys for workspace */
export async function GET(req: NextRequest) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized(req);

  const adminCheck = requireAdmin(ctx);
  if (adminCheck) return adminCheck;

  const keys = await listApiKeys(ctx.workspaceId);
  return success({ api_keys: keys });
}

/** POST /api/v1/api-keys — Create a new API key (admin only) */
export async function POST(req: NextRequest) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized(req);

  const adminCheck = requireAdmin(ctx);
  if (adminCheck) return adminCheck;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return badRequest("Invalid JSON body");
  }

  if (!body.name || typeof body.name !== "string") {
    return badRequest("name is required");
  }

  let scopes: string[] | undefined;
  if (body.scopes !== undefined) {
    if (!Array.isArray(body.scopes) || body.scopes.some((scope) => typeof scope !== "string")) {
      return badRequest("scopes must be an array of strings");
    }
    scopes = body.scopes;
  }

  try {
    const result = await createApiKey(ctx.workspaceId, ctx.userId, {
      name: body.name,
      scopes: scopes ?? [...API_KEY_FULL_SCOPES],
      expiresAt: body.expiresAt ? new Date(body.expiresAt as string) : undefined,
    });

    return success(result, 201);
  } catch (err) {
    console.error("Failed to create API key:", err);
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: "Failed to create API key" } },
      { status: 500 }
    );
  }
}
