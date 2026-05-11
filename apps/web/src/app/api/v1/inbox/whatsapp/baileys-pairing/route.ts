/**
 * Baileys pairing-lifecycle webhook.
 *
 * The in-house Baileys bridge POSTs here whenever a `connection.update`
 * event fires on one of its sockets — QR refresh, pairing-code emission,
 * connect, logout, error. We mirror the relevant bits onto the
 * `channel_accounts` row so the integrations UI can render the QR / pairing
 * code without round-tripping through the bridge.
 *
 * On `status='logged_out'` we also flip `is_active=false` and clear the
 * encrypted auth-state blob in `workspace_settings` — the device was
 * unlinked from the phone, the Signal keys are useless.
 *
 * Auth: Bearer `oc_sk_*` API key, scoped to a workspace.
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { channelAccounts } from "@/db/schema/inbox";
import { and, eq, isNull } from "drizzle-orm";
import { getAuthContext, unauthorized, badRequest } from "@/lib/api-utils";
import { deleteSetting } from "@/services/workspace-settings";

export const dynamic = "force-dynamic";

type PairingStatus =
  | "idle"
  | "awaiting_qr"
  | "awaiting_code"
  | "connecting"
  | "connected"
  | "logged_out"
  | "error";

interface Payload {
  /** UUID of the channel_accounts row (Baileys-only). */
  accountId: string;
  /** Lifecycle state the bridge is reporting. */
  status: PairingStatus;
  /** Raw QR string from `connection.update`. Only set during awaiting_qr. */
  qrPayload?: string | null;
  /** 8-char pairing code from `requestPairingCode`. Only set during awaiting_code. */
  pairingCode?: string | null;
  /** The account's own JID after first successful connect. */
  ownJid?: string | null;
  /** Free-text disconnect reason (Boom statusCode + name) for diagnostics. */
  disconnectReason?: string | null;
}

const ALLOWED_STATUS: ReadonlySet<PairingStatus> = new Set([
  "idle",
  "awaiting_qr",
  "awaiting_code",
  "connecting",
  "connected",
  "logged_out",
  "error",
]);

export async function POST(req: NextRequest) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();

  let payload: Payload;
  try {
    payload = (await req.json()) as Payload;
  } catch {
    return badRequest("invalid_json");
  }

  if (!payload.accountId || typeof payload.accountId !== "string") {
    return badRequest("accountId required");
  }
  if (!payload.status || !ALLOWED_STATUS.has(payload.status)) {
    return badRequest(
      "status must be one of: idle | awaiting_qr | awaiting_code | connecting | connected | logged_out | error"
    );
  }

  const [account] = await db
    .select()
    .from(channelAccounts)
    .where(
      and(
        eq(channelAccounts.id, payload.accountId),
        eq(channelAccounts.workspaceId, ctx.workspaceId),
        eq(channelAccounts.channelType, "whatsapp"),
        isNull(channelAccounts.waPhoneNumberId)
      )
    )
    .limit(1);

  if (!account) {
    return NextResponse.json(
      { error: "channel_account_not_baileys_or_not_found" },
      { status: 404 }
    );
  }

  // Build the patch. We only touch fields the bridge sent — QR refreshes
  // mustn't clear the previous own-JID, and a "connecting" tick mustn't
  // wipe the QR while the operator is still scanning.
  const now = new Date();
  const patch: Partial<typeof channelAccounts.$inferInsert> = {
    baileysPairingStatus: payload.status,
    baileysLastSeenAt: now,
    updatedAt: now,
  };

  if (typeof payload.qrPayload === "string") {
    patch.baileysQrPayload = payload.qrPayload;
    patch.baileysQrUpdatedAt = now;
  } else if (payload.status === "connected" || payload.status === "logged_out") {
    // Clear the now-stale QR once the lifecycle has moved past pairing.
    patch.baileysQrPayload = null;
    patch.baileysQrUpdatedAt = null;
    patch.baileysPairingCode = null;
  }

  if (typeof payload.pairingCode === "string") {
    patch.baileysPairingCode = payload.pairingCode;
  }

  if (typeof payload.ownJid === "string") {
    patch.baileysOwnJid = payload.ownJid;
  }

  if (typeof payload.disconnectReason === "string") {
    patch.baileysLastDisconnectReason = payload.disconnectReason;
  }

  if (payload.status === "logged_out") {
    // The device was unlinked. Auth state is dead; clear it. Stop the
    // socket from auto-restarting next time the bridge boots.
    patch.isActive = false;
    try {
      await deleteSetting(
        ctx.workspaceId,
        `baileys.auth_state.${account.id}`
      );
    } catch (err) {
      console.error(
        "[baileys-pairing] failed to clear auth state on logout:",
        err
      );
    }
  }

  await db
    .update(channelAccounts)
    .set(patch)
    .where(eq(channelAccounts.id, account.id));

  return NextResponse.json({ success: true, status: payload.status });
}
