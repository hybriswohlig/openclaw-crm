/**
 * List endpoint the in-house Baileys bridge calls on bootstrap.
 *
 * Returns every active `channel_accounts` row in the caller's workspace
 * that is:
 *   - channelType='whatsapp'
 *   - waPhoneNumberId IS NULL  (Baileys, not WABA)
 *   - baileysBridgeProvider='inhouse'  (this bridge, not OpenClaw)
 *   - isActive=true
 *
 * The bridge spins up one Baileys socket per row, pulling the encrypted
 * auth state from /baileys-creds/{id}. Rows with status='logged_out' are
 * already isActive=false and therefore excluded.
 *
 * Auth: Bearer `oc_sk_*` API key, scoped to a workspace.
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { channelAccounts } from "@/db/schema/inbox";
import { and, eq, isNull } from "drizzle-orm";
import { getAuthContext, unauthorized } from "@/lib/api-utils";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();

  const rows = await db
    .select({
      id: channelAccounts.id,
      name: channelAccounts.name,
      address: channelAccounts.address,
      pairingStatus: channelAccounts.baileysPairingStatus,
      ownJid: channelAccounts.baileysOwnJid,
      operatingCompanyRecordId: channelAccounts.operatingCompanyRecordId,
    })
    .from(channelAccounts)
    .where(
      and(
        eq(channelAccounts.workspaceId, ctx.workspaceId),
        eq(channelAccounts.channelType, "whatsapp"),
        eq(channelAccounts.isActive, true),
        eq(channelAccounts.baileysBridgeProvider, "inhouse"),
        isNull(channelAccounts.waPhoneNumberId)
      )
    );

  return NextResponse.json({ accounts: rows });
}
