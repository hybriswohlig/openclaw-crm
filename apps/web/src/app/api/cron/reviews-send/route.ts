/**
 * Post-move reviews engine — 15-min cron trigger ([KOT-622] / [KOT-603]).
 *
 * Vercel Cron POSTs every 15 minutes with `Authorization: Bearer <CRON_SECRET>`.
 * For each completed move whose `move_completed_at` falls in the
 * 4–24h send window, we run the negative-experience valve and either:
 *   - dispatch a Variant A or B SMS via MessageBird (PR #16) and stamp
 *     review_request_status = 'sent_sms', OR
 *   - mark complaint_routed and let the inbound scanner ([KOT-623])
 *     handle the CEO-email forward + Template C auto-response, OR
 *   - mark suppressed (quiet hours / cap), OR
 *   - mark failed (after 2 send attempts).
 *
 * Quiet hours: 09:00–19:00 Europe/Berlin, no Sundays. If the 24h cap
 * cannot be honored inside the window, mark suppressed.
 *
 * Phase 1 ships SMS-only per CEO default 1 on KOT-603. Phase 2 ([KOT-618])
 * flips the primary channel to WhatsApp behind the same shape.
 */

import { NextRequest, NextResponse } from "next/server";
import { and, eq, gte, lt } from "drizzle-orm";
import { db } from "@/db";
import {
  workspaces,
  objects,
  attributes,
  records,
  recordValues,
  reviewEvents,
  reviewTokens,
  inboxContacts,
  statuses,
} from "@/db/schema";
import { getSingletonWorkspaceId } from "@/services/workspace";
import { scanInternalNotes } from "@/lib/reviews/valve";
import {
  assignVariant,
  resolveDestination,
  renderVariantA,
  renderVariantB,
  type Brand,
} from "@/lib/reviews/templates";
import { sendSms, MessagingSendError } from "@/lib/messaging";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const SEND_WINDOW_START_MS = 4 * 60 * 60 * 1000; // 4 h
const SEND_WINDOW_END_MS = 24 * 60 * 60 * 1000; // 24 h
const TOKEN_ALPHABET = "abcdefghijklmnopqrstuvwxyz234567"; // base32 lower
const TOKEN_LENGTH = 16;

interface CronResult {
  scanned: number;
  sent: number;
  suppressed: number;
  complaint_routed: number;
  failed: number;
  skipped_reason?: string;
}

export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  const workspaceId = await getSingletonWorkspaceId();
  if (!workspaceId) {
    return NextResponse.json({ error: "no workspace" }, { status: 500 });
  }

  // Quiet-hours check, Europe/Berlin.
  const quiet = isQuietHoursBerlin(new Date());
  if (quiet) {
    return NextResponse.json({ skipped: "quiet_hours" });
  }

  // Feature flag.
  const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1);
  const settings = (ws?.settings as Record<string, unknown> | null) ?? {};
  if (settings["reviews_engine_enabled"] === false) {
    return NextResponse.json({ skipped: "engine_disabled" });
  }

  try {
    const result = await runReviewsCron(workspaceId);
    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    console.error("[cron/reviews-send]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "cron failed" },
      { status: 500 }
    );
  }
}

// ─── Quiet hours helper ───────────────────────────────────────────────────────

export function isQuietHoursBerlin(now: Date): boolean {
  // Use Intl to avoid pulling a tz library. Format yields "Mo, Di, …, So" for
  // German and "Mon, Tue, …, Sun" for English; we use 'en-US' for stable parsing.
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Berlin",
    weekday: "short",
    hour: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(now);
  const weekday = parts.find((p) => p.type === "weekday")?.value;
  const hour = Number(parts.find((p) => p.type === "hour")?.value);
  if (weekday === "Sun") return true;
  if (Number.isNaN(hour)) return true;
  return hour < 9 || hour >= 19;
}

// ─── Main loop ────────────────────────────────────────────────────────────────

async function runReviewsCron(workspaceId: string): Promise<CronResult> {
  const result: CronResult = { scanned: 0, sent: 0, suppressed: 0, complaint_routed: 0, failed: 0 };

  // 1) Resolve the deal object + attribute IDs we'll need by slug.
  const [dealObj] = await db
    .select()
    .from(objects)
    .where(and(eq(objects.workspaceId, workspaceId), eq(objects.slug, "deals")))
    .limit(1);
  if (!dealObj) return { ...result, skipped_reason: "no_deals_object" };

  const attrRows = await db.select().from(attributes).where(eq(attributes.objectId, dealObj.id));
  const attrBySlug = new Map(attrRows.map((a) => [a.slug, a] as const));
  const need = (slug: string) => {
    const a = attrBySlug.get(slug);
    if (!a) throw new Error(`Missing deal attribute: ${slug} — run pnpm db:sync-objects`);
    return a;
  };
  const moveCompletedAtAttr = need("move_completed_at");
  const reviewStatusAttr = need("review_request_status");
  const consentAtAttr = need("review_contact_consent_at");
  const dncAttr = need("do_not_contact_review");
  const ratingAttr = attrBySlug.get("internal_quality_rating");
  const notesAttr = attrBySlug.get("internal_quality_notes");
  const positiveAttr = attrBySlug.get("crew_positive_note");
  const brandAttr = need("brand");
  const variantAttr = need("review_request_variant");
  const sentAtAttr = need("review_request_sent_at");
  const attemptsAttr = need("review_request_attempt_count");
  const destAttr = need("review_destination");
  const complaintHitsAttr = need("complaint_keywords_hit");
  const firstNameAttr = attrBySlug.get("name");

  // 2) Find candidate deals: move_completed_at in the 4–24h window.
  const now = new Date();
  const earliest = new Date(now.getTime() - SEND_WINDOW_END_MS);
  const latest = new Date(now.getTime() - SEND_WINDOW_START_MS);
  const candidates = await db
    .select({ recordId: recordValues.recordId, completedAt: recordValues.timestampValue })
    .from(recordValues)
    .where(
      and(
        eq(recordValues.attributeId, moveCompletedAtAttr.id),
        gte(recordValues.timestampValue, earliest),
        lt(recordValues.timestampValue, latest)
      )
    );

  // 3) Pre-load the relevant statuses for the review_request_status attribute
  //    so we can resolve title → status row id without a per-deal round-trip.
  const statusRows = await db
    .select()
    .from(statuses)
    .where(eq(statuses.attributeId, reviewStatusAttr.id));
  const statusByTitle = new Map(statusRows.map((s) => [s.title, s] as const));

  // 4) For each candidate, load all attribute values, filter, and act.
  for (const cand of candidates) {
    result.scanned++;
    const dealId = cand.recordId;
    const values = await db.select().from(recordValues).where(eq(recordValues.recordId, dealId));
    const valByAttr = new Map(values.map((v) => [v.attributeId, v] as const));

    // Already-sent / already-routed deals should be skipped.
    const currentStatus = valByAttr.get(reviewStatusAttr.id);
    const currentStatusTitle = currentStatus?.referencedRecordId
      ? statusRows.find((s) => s.id === currentStatus.referencedRecordId)?.title
      : null;
    if (currentStatusTitle && currentStatusTitle !== "not_due") continue;

    // Consent gate.
    if (!valByAttr.get(consentAtAttr.id)?.timestampValue) continue;

    // Hard suppression flag.
    if (valByAttr.get(dncAttr.id)?.booleanValue === true) continue;

    // Rating gate (allow null = no rating yet, only block if 1-3).
    const rating = valByAttr.get(ratingAttr?.id ?? "")?.numberValue;
    if (rating != null && Number(rating) < 4) {
      // Pre-send valve fires on low rating too — route as complaint.
      await routeAsComplaint({
        workspaceId,
        dealId,
        keywords: ["internal_quality_rating<4"],
        statusByTitle,
        reviewStatusAttr,
        complaintHitsAttr,
      });
      result.complaint_routed++;
      continue;
    }

    // Internal notes valve.
    const internalNotes = valByAttr.get(notesAttr?.id ?? "")?.textValue ?? null;
    const valve = scanInternalNotes(internalNotes);
    if (valve.matched) {
      await routeAsComplaint({
        workspaceId,
        dealId,
        keywords: valve.hits,
        statusByTitle,
        reviewStatusAttr,
        complaintHitsAttr,
      });
      result.complaint_routed++;
      continue;
    }

    // Resolve customer phone via inbox_contacts.crm_record_id link.
    const [contact] = await db
      .select()
      .from(inboxContacts)
      .where(eq(inboxContacts.crmRecordId, dealId))
      .limit(1);
    const phone = contact?.phone ?? null;
    if (!phone) continue;

    // Resolve brand → destination URL.
    const brandTitle = await resolveSelectTitle(valByAttr.get(brandAttr.id));
    if (brandTitle !== "kottke" && brandTitle !== "ceylan") continue;
    const brand = brandTitle as Brand;
    let destination: ReturnType<typeof resolveDestination>;
    try {
      destination = resolveDestination(brand);
    } catch {
      // No GBP url configured — mark failed and move on.
      result.failed++;
      await markFailed({ workspaceId, dealId, statusByTitle, reviewStatusAttr });
      continue;
    }

    // Variant assignment + body.
    const variant = assignVariant(dealId);
    const positiveNote = valByAttr.get(positiveAttr?.id ?? "")?.textValue ?? null;
    const firstName =
      valByAttr.get(firstNameAttr?.id ?? "")?.textValue?.split(/\s+/)[0] ?? "Kunde";
    const crewLeadFirstName = "das Kottke-Team"; // Phase 1 placeholder; cron has no crew-lead lookup yet.

    // Mint a token + insert review_tokens row.
    const token = generateToken();
    await db.insert(reviewTokens).values({
      token,
      workspaceId,
      dealRecordId: dealId,
      destinationUrl: destination.url,
    });
    const reviewLink = `${process.env.NEXT_PUBLIC_APP_URL ?? "https://darioushkottke.online"}/r/${token}`;

    const body =
      variant === "B"
        ? renderVariantB({ brand, firstName, crewLeadFirstName, crewPositiveNote: positiveNote, reviewLink })
        : renderVariantA({ brand, firstName, crewLeadFirstName, reviewLink });

    // Send.
    const currentAttempts = Number(valByAttr.get(attemptsAttr.id)?.numberValue ?? 0);
    try {
      const sendResult = await sendSms(phone, body);
      // Persist success state.
      await stampSendSuccess({
        workspaceId,
        dealId,
        variant,
        destinationKind: destination.kind,
        statusByTitle,
        reviewStatusAttr,
        variantAttr,
        sentAtAttr,
        attemptsAttr,
        destAttr,
        currentAttempts,
        externalMessageId: sendResult.id,
      });
      result.sent++;
    } catch (err) {
      const isMessagingErr = err instanceof MessagingSendError;
      console.warn("[cron/reviews-send] send failed", { dealId, err: isMessagingErr ? err.cause : String(err) });
      const nextAttempts = currentAttempts + 1;
      await upsertNumberValue(dealId, attemptsAttr.id, nextAttempts);
      if (nextAttempts >= 2) {
        await markFailed({ workspaceId, dealId, statusByTitle, reviewStatusAttr });
        result.failed++;
      }
      // Otherwise leave status as not_due so the next tick retries within the 24h cap.
    }
  }

  return result;
}

// ─── Token generation ─────────────────────────────────────────────────────────

function generateToken(): string {
  const { randomBytes } = require("crypto") as typeof import("crypto");
  const bytes = randomBytes(TOKEN_LENGTH);
  let out = "";
  for (let i = 0; i < TOKEN_LENGTH; i++) {
    out += TOKEN_ALPHABET[bytes[i]! % TOKEN_ALPHABET.length];
  }
  return out;
}

// ─── OAV write helpers ────────────────────────────────────────────────────────

async function upsertSingleValue(
  recordId: string,
  attributeId: string,
  patch: Partial<typeof recordValues.$inferInsert>
) {
  await db
    .delete(recordValues)
    .where(and(eq(recordValues.recordId, recordId), eq(recordValues.attributeId, attributeId)));
  await db.insert(recordValues).values({ recordId, attributeId, ...patch });
}

async function upsertTimestampValue(recordId: string, attributeId: string, value: Date) {
  await upsertSingleValue(recordId, attributeId, { timestampValue: value });
}

async function upsertNumberValue(recordId: string, attributeId: string, value: number) {
  await upsertSingleValue(recordId, attributeId, { numberValue: String(value) });
}

async function upsertTextValue(recordId: string, attributeId: string, value: string) {
  await upsertSingleValue(recordId, attributeId, { textValue: value });
}

async function upsertReferenceValue(recordId: string, attributeId: string, refId: string) {
  await upsertSingleValue(recordId, attributeId, { referencedRecordId: refId });
}

// For `select` attributes the canonical row stores `referencedRecordId =
// select_options.id`. The brand attribute is read by joining select_options.
// Phase-1 utility: pull the option title given a record_values row.
async function resolveSelectTitle(rv: typeof recordValues.$inferSelect | undefined): Promise<string | null> {
  if (!rv?.referencedRecordId) return rv?.textValue ?? null;
  // We don't have selectOptions imported here; the value is also written as
  // textValue in the existing seed path, so try that first. Fallback joins
  // can be added later if select-as-reference ever ships.
  return rv.textValue ?? null;
}

// ─── Status transitions ───────────────────────────────────────────────────────

async function routeAsComplaint(args: {
  workspaceId: string;
  dealId: string;
  keywords: string[];
  statusByTitle: Map<string, typeof statuses.$inferSelect>;
  reviewStatusAttr: typeof attributes.$inferSelect;
  complaintHitsAttr: typeof attributes.$inferSelect;
}) {
  const status = args.statusByTitle.get("complaint_routed");
  if (status) {
    await upsertReferenceValue(args.dealId, args.reviewStatusAttr.id, status.id);
  }
  await upsertTextValue(args.dealId, args.complaintHitsAttr.id, args.keywords.join(","));
  await db.insert(reviewEvents).values({
    workspaceId: args.workspaceId,
    dealRecordId: args.dealId,
    eventType: "complaint_routed",
    channel: "sms",
    meta: { source: "cron_pre_send_valve", keywords: args.keywords },
  });
}

async function markFailed(args: {
  workspaceId: string;
  dealId: string;
  statusByTitle: Map<string, typeof statuses.$inferSelect>;
  reviewStatusAttr: typeof attributes.$inferSelect;
}) {
  const status = args.statusByTitle.get("failed");
  if (status) {
    await upsertReferenceValue(args.dealId, args.reviewStatusAttr.id, status.id);
  }
  await db.insert(reviewEvents).values({
    workspaceId: args.workspaceId,
    dealRecordId: args.dealId,
    eventType: "failed",
    channel: "sms",
    meta: {},
  });
}

async function stampSendSuccess(args: {
  workspaceId: string;
  dealId: string;
  variant: "A" | "B";
  destinationKind: string;
  statusByTitle: Map<string, typeof statuses.$inferSelect>;
  reviewStatusAttr: typeof attributes.$inferSelect;
  variantAttr: typeof attributes.$inferSelect;
  sentAtAttr: typeof attributes.$inferSelect;
  attemptsAttr: typeof attributes.$inferSelect;
  destAttr: typeof attributes.$inferSelect;
  currentAttempts: number;
  externalMessageId: string;
}) {
  const sentStatus = args.statusByTitle.get("sent_sms");
  if (sentStatus) {
    await upsertReferenceValue(args.dealId, args.reviewStatusAttr.id, sentStatus.id);
  }
  await upsertTimestampValue(args.dealId, args.sentAtAttr.id, new Date());
  await upsertTextValue(args.dealId, args.variantAttr.id, args.variant);
  await upsertTextValue(args.dealId, args.destAttr.id, args.destinationKind);
  await upsertNumberValue(args.dealId, args.attemptsAttr.id, args.currentAttempts + 1);

  await db.insert(reviewEvents).values({
    workspaceId: args.workspaceId,
    dealRecordId: args.dealId,
    eventType: "sent_sms",
    variant: args.variant,
    channel: "sms",
    meta: { external_message_id: args.externalMessageId, destination: args.destinationKind },
  });
}
