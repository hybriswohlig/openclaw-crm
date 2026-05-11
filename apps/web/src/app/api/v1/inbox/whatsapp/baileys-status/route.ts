/**
 * Baileys delivery / read receipt webhook.
 *
 * The in-house Baileys bridge POSTs here when a `messages.update` event
 * fires on a socket — i.e. the customer's phone delivered or read one of
 * our outbound messages. We mirror these into `inbox_messages.status` so
 * the inbox UI shows the same ticks WABA already produces.
 *
 * Auth: Bearer `oc_sk_*` API key, scoped to a workspace.
 *
 * Idempotent — last write of the higher-precedence status wins.
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import {
  channelAccounts,
  inboxConversations,
  inboxMessages,
} from "@/db/schema/inbox";
import { and, eq, isNull, sql } from "drizzle-orm";
import { getAuthContext, unauthorized, badRequest } from "@/lib/api-utils";

export const dynamic = "force-dynamic";

type BaileysStatus = "sent" | "delivered" | "read" | "failed";

interface Payload {
  /** UUID of the channel_accounts row (Baileys-only). */
  accountId: string;
  /** key.id Baileys returned for the original outbound send. */
  externalMessageId: string;
  /** New status reported by the socket. */
  status: BaileysStatus;
  /** ISO timestamp the receipt was emitted by Baileys. Optional. */
  timestamp?: string;
  /** Free-text error from the socket if status === "failed". */
  errorReason?: string | null;
}

const ALLOWED_STATUS: ReadonlySet<BaileysStatus> = new Set([
  "sent",
  "delivered",
  "read",
  "failed",
]);

// Map Baileys' four-state model into our message_status enum. We don't carry
// "read" as its own enum value — collapse to "delivered" which is the existing
// terminal positive state in the WABA path.
function mapToEnum(s: BaileysStatus): "sent" | "delivered" | "failed" {
  if (s === "read") return "delivered";
  return s;
}

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
  if (
    !payload.externalMessageId ||
    typeof payload.externalMessageId !== "string"
  ) {
    return badRequest("externalMessageId required");
  }
  if (!payload.status || !ALLOWED_STATUS.has(payload.status)) {
    return badRequest(
      "status must be one of: sent | delivered | read | failed"
    );
  }

  // Resolve the account, scoped to this workspace + Baileys-only.
  const [account] = await db
    .select({ id: channelAccounts.id })
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

  // Find conversations belonging to this account (for the WHERE) and update
  // any matching outbound message. The unique constraint
  // (conversation_id, external_message_id) means at most one row matches.
  const nextStatus = mapToEnum(payload.status);

  const result = await db.execute(sql`
    UPDATE inbox_messages
       SET status = ${nextStatus}
     WHERE external_message_id = ${payload.externalMessageId}
       AND workspace_id = ${ctx.workspaceId}
       AND conversation_id IN (
         SELECT id FROM ${inboxConversations}
          WHERE channel_account_id = ${account.id}
       )
  `);

  // Best-effort: if status='failed' and we have a reason, stash it in
  // raw_headers so support can see why.
  if (payload.status === "failed" && payload.errorReason) {
    await db
      .update(inboxMessages)
      .set({
        rawHeaders: JSON.stringify({
          provider: "baileys",
          baileysError: payload.errorReason,
        }),
      })
      .where(
        and(
          eq(inboxMessages.workspaceId, ctx.workspaceId),
          eq(inboxMessages.externalMessageId, payload.externalMessageId)
        )
      );
  }

  return NextResponse.json({
    success: true,
    rowsAffected: result.length,
    nextStatus,
  });
}
