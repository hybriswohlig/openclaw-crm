import { NextRequest, NextResponse } from "next/server";
import { eq, and } from "drizzle-orm";
import { google } from "googleapis";
import { getAuthContext, unauthorized, requireChannelManager } from "@/lib/api-utils";
import { db } from "@/db";
import { channelAccounts } from "@/db/schema/inbox";
import { makeOAuthClient, getAppBaseUrl } from "@/lib/gmail/client";
import { decodeState } from "@/lib/gmail/oauth-state";
import { setSecret } from "@/services/workspace-settings";

export const dynamic = "force-dynamic";

/** Build the redirect back to the integrations page with a result flag. */
function backTo(params: Record<string, string>): NextResponse {
  const url = new URL(`${getAppBaseUrl()}/integrations`);
  url.searchParams.set("gmail", params.gmail);
  for (const [k, v] of Object.entries(params)) {
    if (k !== "gmail") url.searchParams.set(k, v);
  }
  return NextResponse.redirect(url.toString());
}

/**
 * Step 2 of the Gmail connect flow. Google redirects the admin's browser here
 * with an authorization code. We exchange it for a refresh token, store that
 * ENCRYPTED (never in the plaintext credential column), flip the channel account
 * to the gmail_api transport, and seed the history cursor from the profile.
 */
export async function GET(req: NextRequest) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();
  const deny = requireChannelManager(ctx);
  if (deny) return deny;

  const code = req.nextUrl.searchParams.get("code");
  const stateRaw = req.nextUrl.searchParams.get("state");
  const googleError = req.nextUrl.searchParams.get("error");

  if (googleError) return backTo({ gmail: "error", reason: googleError });
  if (!code || !stateRaw) return backTo({ gmail: "error", reason: "missing_code" });

  const state = decodeState(stateRaw);
  if (!state) return backTo({ gmail: "error", reason: "bad_state" });
  if (state.workspaceId !== ctx.workspaceId) {
    return backTo({ gmail: "error", reason: "workspace_mismatch" });
  }

  const [account] = await db
    .select()
    .from(channelAccounts)
    .where(
      and(
        eq(channelAccounts.id, state.channelAccountId),
        eq(channelAccounts.workspaceId, ctx.workspaceId)
      )
    )
    .limit(1);

  if (!account) return backTo({ gmail: "error", reason: "account_not_found" });

  try {
    const oauth = makeOAuthClient(account.address);
    const { tokens } = await oauth.getToken(code);

    const refreshToken = tokens.refresh_token;
    if (!refreshToken) {
      // Happens if the admin had already granted access without offline scope.
      // prompt=consent should prevent this; surface a clear retry hint.
      return backTo({ gmail: "error", reason: "no_refresh_token" });
    }

    // Use the fresh access token to read the mailbox profile (verified address +
    // the historyId we start incremental sync from).
    oauth.setCredentials(tokens);
    const gmail = google.gmail({ version: "v1", auth: oauth });
    const prof = await gmail.users.getProfile({ userId: "me" });
    const connectedAddress = prof.data.emailAddress ?? account.address;
    const historyId = prof.data.historyId ?? null;

    // Store the refresh token encrypted (pgp_sym_encrypt via workspace-settings).
    await setSecret(ctx.workspaceId, `gmail_refresh:${account.id}`, refreshToken);

    await db
      .update(channelAccounts)
      .set({
        emailProvider: "gmail_api",
        address: connectedAddress,
        lastSyncHistoryId: historyId,
        // A reconnect re-activates an account we may have auto-disabled on a dead
        // token, and clears the stale IMAP cursor.
        isActive: true,
        lastSyncUid: 0,
        updatedAt: new Date(),
      })
      .where(eq(channelAccounts.id, account.id));

    return backTo({ gmail: "connected", address: connectedAddress });
  } catch (err) {
    console.error("[gmail oauth callback]", err);
    return backTo({ gmail: "error", reason: "exchange_failed" });
  }
}
