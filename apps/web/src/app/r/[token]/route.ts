/**
 * Tracked review-link redirect — `/r/{token}` ([KOT-619] / [KOT-603]).
 *
 * Public, GET-only, no auth. Phase 1 lives on `darioushkottke.online`;
 * once a `kottke.link` short domain is provisioned, CNAME it without
 * touching the code.
 *
 * Behavior:
 *   1. Look up the token in `review_tokens`. 404 on miss.
 *   2. On first click: stamp `clicked_at` / `click_user_agent` /
 *      `click_ip`, write a `review_events` row of `event_type='clicked'`,
 *      and update the deal's `review_request_clicked_at` attribute.
 *   3. 302-redirect to the pre-resolved per-brand `destination_url`.
 *
 * Idempotent for repeated hits — only the first click logs an event so
 * the reporting view's `clicks` counter isn't inflated by browser
 * prefetches or chat-app link previews. The redirect itself always
 * fires.
 */

import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  reviewTokens,
  reviewEvents,
  records,
  recordValues,
  attributes,
} from "@/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;

  const [tok] = await db.select().from(reviewTokens).where(eq(reviewTokens.token, token)).limit(1);
  if (!tok) return notFoundPage();

  if (tok.clickedAt === null) {
    const userAgent = req.headers.get("user-agent");
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;

    // Best-effort writes; failures shouldn't block the customer's redirect.
    try {
      await db
        .update(reviewTokens)
        .set({
          clickedAt: new Date(),
          clickUserAgent: userAgent ?? null,
          clickIp: ip,
        })
        .where(eq(reviewTokens.token, token));

      await db.insert(reviewEvents).values({
        workspaceId: tok.workspaceId,
        dealRecordId: tok.dealRecordId,
        eventType: "clicked",
        channel: "sms",
        meta: { user_agent: userAgent ?? null, ip: ip ?? null },
      });

      await stampDealClickedAt(tok.dealRecordId);
    } catch (err) {
      console.error("[reviews redirect] click logging failed:", err);
    }
  }

  return NextResponse.redirect(tok.destinationUrl, 302);
}

/**
 * Customers open these links from a WhatsApp or SMS thread, so an expired
 * token must read as a normal German page, not a bare "Not found". Inline
 * styles in the portal palette, no assets to load.
 */
function notFoundPage(): NextResponse {
  const html = `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Link nicht gefunden</title>
</head>
<body style="margin:0;display:flex;min-height:100vh;align-items:center;justify-content:center;padding:24px;background:#f7f8fa;color:#0f1722;font-family:system-ui,-apple-system,sans-serif;text-align:center;">
<main>
<h1 style="margin:0;font-size:20px;font-weight:600;">Link nicht gefunden</h1>
<p style="margin:12px auto 0;max-width:26rem;font-size:15px;line-height:1.6;color:#56627a;">Dieser Bewertungslink ist leider nicht mehr g&uuml;ltig. Antworten Sie einfach auf die Nachricht, mit der Sie ihn erhalten haben.</p>
</main>
</body>
</html>`;
  return new NextResponse(html, {
    status: 404,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

async function stampDealClickedAt(dealRecordId: string): Promise<void> {
  const [deal] = await db.select().from(records).where(eq(records.id, dealRecordId)).limit(1);
  if (!deal) return;
  const [attr] = await db
    .select()
    .from(attributes)
    .where(and(eq(attributes.objectId, deal.objectId), eq(attributes.slug, "review_request_clicked_at")))
    .limit(1);
  if (!attr) return;

  // record_values has no unique constraint on (record_id, attribute_id), so
  // delete-then-insert is the convention for single-valued attributes used
  // elsewhere in the codebase. First-click only — repeat hits short-circuit
  // above on tok.clickedAt being non-null.
  await db
    .delete(recordValues)
    .where(and(eq(recordValues.recordId, dealRecordId), eq(recordValues.attributeId, attr.id)));
  await db.insert(recordValues).values({
    recordId: dealRecordId,
    attributeId: attr.id,
    timestampValue: new Date(),
  });
}
