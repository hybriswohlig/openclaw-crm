/**
 * Record an already-sent Baileys message as outbound history.
 *
 * This route only inserts. It does not call the bridge, `sendMessage`, or
 * any CRM send helper (`sendBaileysReply`, `callBridgeSend`, …). A caller
 * cannot turn a backfill into a WhatsApp delivery by any field in the body.
 *
 * Idempotent on (channel account, externalMessageId): posting the same
 * WhatsApp id again returns `duplicate: true` and does not write a second row.
 * The lookup is the account in the body — another account in the workspace
 * (for example Ceylan) is never read or updated.
 *
 * Auth: Bearer workspace API key, same as `/baileys-outbound`.
 */
import { NextRequest, NextResponse } from "next/server";
import { findeInterne, ladeInterneNummern } from "@/services/intern/interne-nummern";
import { db } from "@/db";
import { channelAccounts } from "@/db/schema/inbox";
import { eq, and, isNull } from "drizzle-orm";
import { getAuthContext, unauthorized } from "@/lib/api-utils";
import { ingestOutboundWhatsAppMessage } from "@/services/inbox-whatsapp";

export const dynamic = "force-dynamic";

interface BaileysBackfillPayload {
  /** UUID of the Baileys channel account that sent the message. */
  accountId: string;
  /** Contact phone (digits) or a JID local part. */
  peerWaId?: string;
  /** Full recipient JID. Accepted as the contact address when peerWaId is omitted. */
  peerJid?: string;
  peerLid?: string | null;
  /** WhatsApp message id. Dedupe key. */
  externalMessageId: string;
  /** Message text. `body` is accepted as an alias. */
  text?: string;
  body?: string;
  /** ISO timestamp of the original send. Required so history is not stamped "now". */
  sentAt: string;
}

function badRequest(message: string, extra?: Record<string, unknown>) {
  return NextResponse.json({ error: message, ...extra }, { status: 400 });
}

export async function POST(req: NextRequest) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized(req);

  let payload: BaileysBackfillPayload;
  try {
    payload = (await req.json()) as BaileysBackfillPayload;
  } catch {
    return badRequest("invalid_json");
  }

  if (!payload.accountId || typeof payload.accountId !== "string") {
    return badRequest("accountId required");
  }
  if (!payload.externalMessageId || typeof payload.externalMessageId !== "string") {
    return badRequest("externalMessageId required");
  }
  const text = typeof payload.text === "string" ? payload.text : payload.body;
  if (typeof text !== "string") {
    return badRequest("text required");
  }
  if (!payload.sentAt || typeof payload.sentAt !== "string") {
    return badRequest("sentAt required");
  }
  const sentAt = new Date(payload.sentAt);
  if (Number.isNaN(sentAt.getTime())) {
    return badRequest("sentAt must be a valid ISO timestamp");
  }

  const [account] = await db
    .select()
    .from(channelAccounts)
    .where(
      and(
        eq(channelAccounts.id, payload.accountId),
        eq(channelAccounts.workspaceId, ctx.workspaceId),
        eq(channelAccounts.channelType, "whatsapp"),
        eq(channelAccounts.isActive, true),
        isNull(channelAccounts.waPhoneNumberId),
      ),
    )
    .limit(1);

  if (!account || account.id !== payload.accountId || account.workspaceId !== ctx.workspaceId) {
    return NextResponse.json(
      {
        error: "channel_account_not_baileys_or_not_found",
        hint: "Account must be this workspace's channel_type='whatsapp' row with wa_phone_number_id IS NULL",
      },
      { status: 404 },
    );
  }

  let peerJid: string | null = null;
  if (typeof payload.peerJid === "string" && payload.peerJid) {
    const raw = payload.peerJid.replace(/\s+/g, "");
    if (!/^\+?\d{6,20}(?::\d+)?@(?:lid|hosted\.lid|hosted|s\.whatsapp\.net|c\.us)$/.test(raw)) {
      return badRequest("peerJid must be a 1:1 digits@domain JID", { received: payload.peerJid });
    }
    const at = raw.indexOf("@");
    const local = raw.slice(0, at).replace(/^\+/, "").replace(/:.*$/, "");
    peerJid = `${local}${raw.slice(at)}`;
  }

  const peerSource = payload.peerWaId ?? peerJid ?? "";
  const peerWaId = peerSource
    .replace(/@.*$/, "")
    .replace(/^\+/, "")
    .replace(/:.*$/, "")
    .replace(/\s+/g, "");
  if (!/^\d{6,20}$/.test(peerWaId)) {
    return badRequest("peerWaId or peerJid required", { received: payload.peerWaId ?? payload.peerJid });
  }

  let peerLid: string | null = null;
  if (typeof payload.peerLid === "string" && payload.peerLid) {
    const raw = payload.peerLid.replace(/\s+/g, "");
    const m = raw.match(/^(\d{6,20})(?::\d+)?@((?:hosted\.)?lid)$/);
    if (m) peerLid = `${m[1]}@${m[2]}`;
  }

  const intern = findeInterne(await ladeInterneNummern(account.workspaceId), {
    peerWaId,
    peerJid,
    peerLid,
  });
  if (intern) {
    return NextResponse.json({ ok: true, intern: true, sent: false });
  }

  try {
    const result = await ingestOutboundWhatsAppMessage({
      account,
      peerWaId,
      peerJid,
      peerLid,
      body: text,
      externalMessageId: payload.externalMessageId,
      sentAt,
      origin: "backfill",
      rawHeaders: {
        provider: "baileys",
        source: "backfill",
      },
    });

    return NextResponse.json({
      success: true,
      // Hard-coded. This handler has no send call to flip it.
      sent: false,
      conversationId: result.conversationId,
      dealRecordId: result.dealRecordId,
      messageId: result.messageId,
      duplicate: result.duplicate,
    });
  } catch (err) {
    console.error("[baileys-backfill] ingest failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "ingest_failed" },
      { status: 500 },
    );
  }
}
