/**
 * Tracked review-link redirect — `/r/{token}` ([KOT-619] / [KOT-603]).
 *
 * Public, GET-only, no auth. Phase 1 lives on `darioushkottke.online`;
 * once a `kottke.link` short domain is provisioned, CNAME it without
 * touching the code.
 *
 * Behavior:
 *   1. Look up the token in `review_tokens`. 404 on miss.
 *   2. On the first real click (not a link preview): one atomic update
 *      stamps clicked_at, user agent, ip and zustand 'gesendet' only
 *      while clicked_at is still null. If that update wins, write
 *      review_events 'clicked' (channel via klickKanal) with meta
 *      `{ token }` only, then updateRecord for review_request_clicked_at
 *      and, only when the current title is sent_sms or sent_whatsapp,
 *      review_request_status = the status id titled 'clicked'.
 *   3. 302-redirect to the pre-resolved per-brand `destination_url`.
 *
 * Idempotent for repeated hits — only the first click logs an event so
 * the reporting view's `clicks` counter isn't inflated by browser
 * prefetches or chat-app link previews. The redirect itself always
 * fires.
 *
 * Link-Vorschauen von WhatsApp, Facebook und Telegram (istVorschauAgent)
 * zählen nicht als Klick. Der Kanal des Klicks kommt aus dem Versand, zu dem
 * der Token gehört (review_events, klickKanal), nicht mehr fest „sms“.
 *
 * Öffentlich auf dem CRM-Host (middleware.ts, publicPaths „/r/“). Auf
 * status.*-Hosts leitet die Middleware /r/ weiter auf die Website; der Link
 * nutzt darum immer NEXT_PUBLIC_APP_URL.
 */

import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { attributes, recordValues, records, reviewEvents, reviewTokens, statuses } from "@/db/schema";
import { zeilen } from "@/lib/db-werte";
import { istVorschauAgent, klickKanal } from "@/lib/reviews/klick";
import { updateRecord } from "@/services/records";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATUS_ERSETZBAR = new Set(["sent_sms", "sent_whatsapp"]);

export async function GET(req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;

  const [tok] = await db.select().from(reviewTokens).where(eq(reviewTokens.token, token)).limit(1);
  if (!tok) return notFoundPage();

  const userAgent = req.headers.get("user-agent");
  if (tok.clickedAt === null && !istVorschauAgent(userAgent)) {
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;

    // Best-effort writes; failures shouldn't block the customer's redirect.
    try {
      const gewonnen = zeilen(
        await db.execute(sql`
          UPDATE review_tokens
          SET clicked_at = now(),
              click_user_agent = ${userAgent},
              click_ip = ${ip},
              zustand = 'gesendet',
              zustand_at = now()
          WHERE token = ${token} AND clicked_at IS NULL
          RETURNING token
        `)
      );
      if (gewonnen.length > 0) {
        const versand = await db
          .select({
            eventType: reviewEvents.eventType,
            channel: reviewEvents.channel,
            meta: reviewEvents.meta,
            at: reviewEvents.at,
          })
          .from(reviewEvents)
          .where(
            and(
              eq(reviewEvents.workspaceId, tok.workspaceId),
              eq(reviewEvents.dealRecordId, tok.dealRecordId),
              inArray(reviewEvents.eventType, ["sent_sms", "sent_whatsapp"])
            )
          );
        const channel = klickKanal(versand, tok.token, tok.createdAt);

        await db.insert(reviewEvents).values({
          id: randomUUID(),
          workspaceId: tok.workspaceId,
          dealRecordId: tok.dealRecordId,
          eventType: "clicked",
          channel,
          meta: { token: tok.token },
        });

        await stempelKlick(tok.dealRecordId, new Date());
      }
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

/** Klickzeit und, nur nach sent_sms/sent_whatsapp, Status „clicked“. Nie complaint_routed überschreiben. */
async function stempelKlick(dealId: string, wann: Date): Promise<void> {
  const [deal] = await db.select({ objectId: records.objectId }).from(records).where(eq(records.id, dealId)).limit(1);
  if (!deal) return;

  const attrRows = await db.select().from(attributes).where(eq(attributes.objectId, deal.objectId));
  const statusAttr = attrRows.find((a) => a.slug === "review_request_status");
  const input: Record<string, unknown> = { review_request_clicked_at: wann.toISOString() };

  if (statusAttr) {
    const statusRows = await db.select().from(statuses).where(eq(statuses.attributeId, statusAttr.id));
    const eigene = statusRows.filter((s) => s.attributeId === statusAttr.id);
    const titel = new Map(eigene.map((s) => [s.id, s.title]));
    const idZuTitel = new Map(eigene.map((s) => [s.title, s.id]));
    const werte = await db
      .select({ textValue: recordValues.textValue, attributeId: recordValues.attributeId })
      .from(recordValues)
      .where(and(eq(recordValues.recordId, dealId), eq(recordValues.attributeId, statusAttr.id)));
    const cur = werte.find((v) => v.attributeId === statusAttr.id);
    const title = cur?.textValue ? (titel.get(cur.textValue) ?? null) : null;
    const clickedId = idZuTitel.get("clicked");
    if (clickedId && title && STATUS_ERSETZBAR.has(title)) {
      input.review_request_status = clickedId;
    }
  }

  await updateRecord(deal.objectId, dealId, input, null);
}
