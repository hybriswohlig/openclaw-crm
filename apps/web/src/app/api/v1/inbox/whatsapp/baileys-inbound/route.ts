/**
 * Baileys WhatsApp inbound ingestion endpoint.
 *
 * Bridge for personal-WhatsApp accounts (linked-device via Baileys) where the
 * actual WhatsApp connection is owned by OpenClaw, not by the CRM. OpenClaw
 * receives the raw message, normalizes it, and POSTs the payload here. The
 * CRM then writes it into `inbox_messages` / `inbox_conversations` using the
 * same logic as the WABA Cloud API webhook (see `inbox-whatsapp.ts`).
 *
 * Auth: Bearer token (api_keys table). The middleware lets `/api/*` requests
 * with a Bearer header through; we re-check on this route via getAuthContext
 * so an attacker cannot blindly inject leads.
 *
 * The endpoint is idempotent on `(channelAccountId, externalMessageId)` so
 * OpenClaw can safely retry on transient failures.
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { channelAccounts } from "@/db/schema/inbox";
import { eq, and, isNull } from "drizzle-orm";
import { getAuthContext, unauthorized } from "@/lib/api-utils";
import { ingestInboundWhatsAppMessage } from "@/services/inbox-whatsapp";

export const dynamic = "force-dynamic";

interface BaileysInboundPayload {
  /** UUID of the channel_accounts row (channel_type='whatsapp', wa_phone_number_id IS NULL). */
  accountId: string;
  /** Sender's WhatsApp ID (E.164 with or without leading +). */
  peerWaId: string;
  /** Sender's profile/push name, if known. */
  peerName?: string | null;
  /** Plain-text body. For media-only messages, may be empty (use previewLabel). */
  body: string;
  /** Optional preview label override for media-only messages ("📷 Bild" etc.). */
  previewLabel?: string | null;
  /** Provider-side message ID — used as dedup key. */
  externalMessageId: string;
  /** ISO timestamp of when the message was sent. Defaults to now. */
  sentAt?: string;
  /** Optional metadata blob preserved in raw_headers for debugging. */
  rawHeaders?: Record<string, unknown> | null;
}

function badRequest(message: string, extra?: Record<string, unknown>) {
  return NextResponse.json({ error: message, ...extra }, { status: 400 });
}

export async function POST(req: NextRequest) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();

  let payload: BaileysInboundPayload;
  try {
    payload = (await req.json()) as BaileysInboundPayload;
  } catch {
    return badRequest("invalid_json");
  }

  // Schema check
  if (!payload.accountId || typeof payload.accountId !== "string") {
    return badRequest("accountId required");
  }
  if (!payload.peerWaId || typeof payload.peerWaId !== "string") {
    return badRequest("peerWaId required");
  }
  if (typeof payload.body !== "string") {
    return badRequest("body must be a string");
  }
  if (!payload.externalMessageId || typeof payload.externalMessageId !== "string") {
    return badRequest("externalMessageId required");
  }

  // Resolve channel account, scoped to this workspace + Baileys-only.
  const [account] = await db
    .select()
    .from(channelAccounts)
    .where(
      and(
        eq(channelAccounts.id, payload.accountId),
        eq(channelAccounts.workspaceId, ctx.workspaceId),
        eq(channelAccounts.channelType, "whatsapp"),
        eq(channelAccounts.isActive, true),
        // Baileys-only: WABA accounts are routed via the Meta webhook, not
        // this endpoint. Block accidental cross-routing.
        isNull(channelAccounts.waPhoneNumberId)
      )
    )
    .limit(1);

  if (!account) {
    return NextResponse.json(
      {
        error: "channel_account_not_baileys_or_not_found",
        hint: "Account must be channel_type='whatsapp' with wa_phone_number_id IS NULL",
      },
      { status: 404 }
    );
  }

  // Normalize peer wa-id: strip leading +/whitespace, keep digits.
  // (Baileys typically returns "4915159058963@s.whatsapp.net" — caller
  //  should pre-normalize, but we forgive a bit.)
  const peerWaId = payload.peerWaId
    .replace(/@.*$/, "")
    .replace(/^\+/, "")
    .replace(/\s+/g, "");

  if (!/^\d{6,20}$/.test(peerWaId)) {
    return badRequest("peerWaId must be a digit-only E.164-like phone", { received: payload.peerWaId });
  }

  const sentAt = payload.sentAt ? new Date(payload.sentAt) : new Date();
  if (Number.isNaN(sentAt.getTime())) {
    return badRequest("sentAt must be a valid ISO timestamp");
  }

  try {
    const result = await ingestInboundWhatsAppMessage({
      account,
      peerWaId,
      peerName: payload.peerName ?? null,
      body: payload.body,
      previewLabel: payload.previewLabel ?? null,
      externalMessageId: payload.externalMessageId,
      sentAt,
      toAddress: account.address,
      rawHeaders: { provider: "baileys", ...(payload.rawHeaders ?? {}) },
    });

    return NextResponse.json({
      success: true,
      conversationId: result.conversationId,
      dealRecordId: result.dealRecordId,
      messageId: result.messageId,
      isNewConversation: result.isNewConversation,
      duplicate: result.messageId === null && !result.isNewConversation ? true : undefined,
    });
  } catch (err) {
    console.error("[baileys-inbound] ingest failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "ingest_failed" },
      { status: 500 }
    );
  }
}
