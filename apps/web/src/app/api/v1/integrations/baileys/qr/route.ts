/**
 * QR / pairing-status polling endpoint for the integrations UI.
 *
 * The bridge pushes lifecycle updates (QR string, pairing code, connected,
 * logged_out) into `channel_accounts` via the baileys-pairing webhook. This
 * route just reads those columns — no bridge round-trip needed. The UI
 * polls every 3s while the pairing modal is open.
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { channelAccounts } from "@/db/schema/inbox";
import { and, eq, isNull } from "drizzle-orm";
import {
  getAuthContext,
  unauthorized,
  badRequest,
  notFound,
} from "@/lib/api-utils";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();

  const accountId = req.nextUrl.searchParams.get("accountId");
  if (!accountId) return badRequest("accountId query param required");

  const [row] = await db
    .select({
      id: channelAccounts.id,
      pairingStatus: channelAccounts.baileysPairingStatus,
      qrPayload: channelAccounts.baileysQrPayload,
      qrUpdatedAt: channelAccounts.baileysQrUpdatedAt,
      pairingCode: channelAccounts.baileysPairingCode,
      ownJid: channelAccounts.baileysOwnJid,
      lastSeenAt: channelAccounts.baileysLastSeenAt,
      lastDisconnectReason: channelAccounts.baileysLastDisconnectReason,
      isActive: channelAccounts.isActive,
    })
    .from(channelAccounts)
    .where(
      and(
        eq(channelAccounts.id, accountId),
        eq(channelAccounts.workspaceId, ctx.workspaceId),
        eq(channelAccounts.channelType, "whatsapp"),
        eq(channelAccounts.baileysBridgeProvider, "inhouse"),
        isNull(channelAccounts.waPhoneNumberId),
      ),
    )
    .limit(1);

  if (!row) return notFound("Baileys (in-house) account not found");

  return NextResponse.json(row);
}
