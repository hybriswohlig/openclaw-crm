/**
 * App-level WhatsApp settings: app secret + webhook verify token.
 *
 * Both values are workspace-wide (one Meta App → one secret → one webhook
 * URL), stored encrypted in workspace_settings. GET never returns the raw
 * values — only boolean "configured" flags — so even an admin can't exfiltrate
 * them through the UI.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  getAuthContext,
  unauthorized,
  success,
  requireAdmin,
  badRequest,
} from "@/lib/api-utils";
import { setSecret, getSecret } from "@/services/workspace-settings";
import {
  WA_APP_SECRET_KEY,
  WA_VERIFY_TOKEN_KEY,
} from "@/services/inbox-whatsapp";

export async function GET(req: NextRequest) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();
  const deny = requireAdmin(ctx);
  if (deny) return deny;

  const [appSecret, verifyToken] = await Promise.all([
    getSecret(ctx.workspaceId, WA_APP_SECRET_KEY),
    getSecret(ctx.workspaceId, WA_VERIFY_TOKEN_KEY),
  ]);

  return success({
    hasAppSecret: Boolean(appSecret),
    hasVerifyToken: Boolean(verifyToken),
  });
}

export async function PATCH(req: NextRequest) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();
  const deny = requireAdmin(ctx);
  if (deny) return deny;

  const body = await req.json().catch(() => ({}));
  const appSecret = typeof body.appSecret === "string" ? body.appSecret.trim() : null;
  const verifyToken = typeof body.verifyToken === "string" ? body.verifyToken.trim() : null;

  if (!appSecret && !verifyToken) {
    return badRequest("Provide appSecret and/or verifyToken");
  }

  if (appSecret) await setSecret(ctx.workspaceId, WA_APP_SECRET_KEY, appSecret);
  if (verifyToken) await setSecret(ctx.workspaceId, WA_VERIFY_TOKEN_KEY, verifyToken);

  return success({ ok: true });
}
