/**
 * Opt-in for the in-house Baileys bridge history catch-up.
 *
 * The bridge calls this once per socket spawn. `historySyncSupported: true`
 * tells it to POST `messaging-history.set` rows with `historySync: true`
 * instead of spooling them. `historySince` is the start of the window
 * (default 7 days, `BAILEYS_HISTORY_SYNC_DAYS`). The bridge subtracts a
 * five-minute overlap; the ingest routes accept that same slack.
 *
 * Read-only. Does not open a socket, does not read auth state, and does not
 * send. The excluded channel accounts get `historySyncSupported: false`
 * before any database read, which leaves their sessions untouched and keeps
 * the bridge from posting their history.
 *
 * Auth: Bearer workspace API key, same as the other bridge routes.
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { channelAccounts } from "@/db/schema/inbox";
import { and, eq, isNull } from "drizzle-orm";
import { getAuthContext, unauthorized, requireBridgeApiKey } from "@/lib/api-utils";
import {
  historySinceForBridge,
  historyWindowDays,
  isHistorySyncExcludedAccount,
} from "@/services/baileys-history-sync";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ accountId: string }> },
) {
  const auth = await getAuthContext(req);
  if (!auth) return unauthorized(req);
  const bridgeDenied = requireBridgeApiKey(auth);
  if (bridgeDenied) return bridgeDenied;

  const { accountId } = await ctx.params;
  if (!accountId) {
    return NextResponse.json({ error: "accountId required" }, { status: 400 });
  }

  if (isHistorySyncExcludedAccount(accountId)) {
    return NextResponse.json({ historySyncSupported: false, historySince: null });
  }

  const [account] = await db
    .select({ id: channelAccounts.id })
    .from(channelAccounts)
    .where(
      and(
        eq(channelAccounts.id, accountId),
        eq(channelAccounts.workspaceId, auth.workspaceId),
        eq(channelAccounts.channelType, "whatsapp"),
        eq(channelAccounts.isActive, true),
        eq(channelAccounts.baileysBridgeProvider, "inhouse"),
        isNull(channelAccounts.waPhoneNumberId),
      ),
    )
    .limit(1);

  if (!account || account.id !== accountId) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const windowDays = historyWindowDays();
  return NextResponse.json({
    historySyncSupported: true,
    historySince: historySinceForBridge(new Date(), windowDays),
    windowDays,
  });
}
