import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { and, eq } from "drizzle-orm";
import {
  getAuthContext,
  unauthorized,
  badRequest,
  requireChannelManager,
} from "@/lib/api-utils";
import { db } from "@/db";
import { channelAccounts } from "@/db/schema/inbox";
import { makeOAuthClient, GMAIL_SCOPES, getAppBaseUrl } from "@/lib/gmail/client";
import { encodeState } from "@/lib/gmail/oauth-state";

export const dynamic = "force-dynamic";

/**
 * Step 1 of the Gmail connect flow. Admin (or channel-manager) clicks "Gmail
 * verbinden" for an email channel account; we redirect them to Google's consent
 * screen with offline access so the callback receives a refresh token.
 */
export async function GET(req: NextRequest) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();
  const deny = requireChannelManager(ctx);
  if (deny) return deny;

  const channelAccountId = req.nextUrl.searchParams.get("channelAccountId");
  if (!channelAccountId) return badRequest("channelAccountId is required");

  const [account] = await db
    .select()
    .from(channelAccounts)
    .where(
      and(
        eq(channelAccounts.id, channelAccountId),
        eq(channelAccounts.workspaceId, ctx.workspaceId)
      )
    )
    .limit(1);

  if (!account) return badRequest("Channel account not found");
  if (account.channelType !== "email") {
    return badRequest("Gmail can only be connected to an email channel account");
  }

  let authUrl: string;
  try {
    const oauth = makeOAuthClient(account.address);
    const state = encodeState({
      channelAccountId: account.id,
      workspaceId: ctx.workspaceId,
      nonce: randomUUID(),
    });
    authUrl = oauth.generateAuthUrl({
      access_type: "offline",
      // Force the consent screen so Google always returns a refresh token, even
      // if this admin previously granted access.
      prompt: "consent",
      scope: GMAIL_SCOPES,
      state,
      login_hint: account.address,
      include_granted_scopes: true,
    });
  } catch (err) {
    console.error("[gmail oauth start]", err);
    const back = `${getAppBaseUrl()}/integrations?gmail=error&reason=${encodeURIComponent(
      "no_oauth_client"
    )}`;
    return NextResponse.redirect(back);
  }

  return NextResponse.redirect(authUrl);
}
