/**
 * Session and PDF tracking for the customer status portal.
 *
 * Customer-facing open counts are distinct non-internal rows in
 * `customer_portal_visits`, not the old fire-and-forget `bumpView` on the
 * page render. Link-preview crawlers and HEAD requests are ignored before
 * any write. Writes are try/catch: a missing migration (0057) must never
 * break the portal page or PDF delivery.
 *
 * `sent_at` is set only when an outbound message body contains `/s/<token>`
 * (or the portal-notification email that carries the same URL). It is not
 * set when an operator copies the link.
 */

import { NextRequest } from "next/server";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  customerPortalDocumentViews,
  customerPortalVisits,
  customerStatusLinks,
} from "@/db/schema/customer-portal";
import { dealDocuments } from "@/db/schema/financial";
import { emitEvent } from "@/services/activity-events";
import { getAuthContext } from "@/lib/api-utils";
import { oeffentlichAbrufbar } from "@/lib/portal-dokumente";
import {
  DOCUMENT_VIEW_DEDUPE_MS,
  bodyContainsPortalToken,
  classifyPortalAudience,
  documentAudience,
  documentDisposition,
  internalVisitLabel,
  portalSessionFromRequest,
  shouldDedupeDocumentView,
  shouldRecordDocumentActivity,
  shouldRecordPortalHit,
  shouldRecordPortalOpenActivity,
  type InternalReason,
} from "@/lib/portal-open-tracking";
import { validateTokenShape } from "@openclaw-crm/customer-portal-core";

const TRACK_TIMEOUT_MS = 4000;

export interface VisitBeaconInput {
  sessionId: string;
  activeMsDelta: number;
  visibleMsDelta: number;
  event: "open" | "heartbeat";
  channel: string | null;
  referrer: string | null;
  isMobile: boolean | null;
  stageAtOpen: number | null;
}

export interface DocumentViewAggregate {
  documentId: string;
  fileName: string | null;
  documentType: string | null;
  /** Non-internal fetches. */
  viewCount: number;
  internalViewCount: number;
  firstViewedAt: string | null;
  lastViewedAt: string | null;
}

export interface VisitTelemetry {
  /** Non-internal browser sessions. This is the "× geöffnet" number. */
  sessionCount: number;
  internalSessionCount: number;
  totalActiveMs: number;
  firstViewedAt: string | null;
  lastViewedAt: string | null;
  /**
   * First outbound message that contained the link. Null when not sent yet.
   * `sentSignalAvailable` is false when migration 0057 has not been applied,
   * so the panel must not claim the link was never sent.
   */
  sentAt: string | null;
  sentSignalAvailable: boolean;
  recent: Array<{
    sessionId: string;
    openedAt: string;
    lastHeartbeatAt: string;
    activeMs: number;
    channel: string | null;
    isMobile: boolean | null;
    stageAtOpen: number | null;
    internal: boolean;
    /** "intern/Test" when the row is excluded from customer counts. */
    internalLabel: string | null;
  }>;
  documents: DocumentViewAggregate[];
}

export async function crmUserIdFromRequest(req: NextRequest): Promise<string | null> {
  try {
    const headers = new Headers();
    const cookie = req.headers.get("cookie");
    const authorization = req.headers.get("authorization");
    if (cookie) headers.set("cookie", cookie);
    if (authorization) headers.set("authorization", authorization);
    const probe = new NextRequest("http://crm.local/api/public/track", { headers });
    const ctx = await awaitTracking(getAuthContext(probe), 1500);
    return ctx?.userId ?? null;
  } catch (err) {
    console.error("[portal-tracking] auth", err);
    return null;
  }
}

export function sessionIdFromRequest(req: NextRequest): string | null {
  return portalSessionFromRequest({
    sid: req.nextUrl.searchParams.get("sid"),
    cookie: req.headers.get("cookie"),
  });
}

/**
 * Open or heartbeat. One inserted session row produces at most one
 * "Statuslink geöffnet" activity (unique session id; heartbeats update).
 * Internal and pre-send sessions are stored and do not write activity.
 */
export async function recordVisitBeacon(
  token: string,
  input: VisitBeaconInput,
  ctx: { ipAddress: string; userAgent: string; crmUserId?: string | null; method?: string | null }
): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (!shouldRecordPortalHit({ method: ctx.method ?? "POST", userAgent: ctx.userAgent })) {
    return { ok: true };
  }
  try {
    return await recordVisitBeaconCurrent(token, input, ctx);
  } catch (err) {
    if (!schemaNotReady(err)) {
      console.error("[portal-tracking] beacon", err);
      return { ok: false, reason: "tracking_failed" };
    }
    try {
      return await recordVisitBeaconLegacy(token, input, ctx);
    } catch (legacyErr) {
      console.error("[portal-tracking] beacon legacy", legacyErr);
      return { ok: false, reason: "tracking_failed" };
    }
  }
}

async function recordVisitBeaconCurrent(
  token: string,
  input: VisitBeaconInput,
  ctx: { ipAddress: string; userAgent: string; crmUserId?: string | null }
): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (!validateTokenShape(token)) return { ok: false, reason: "invalid_token" };
  if (!input.sessionId || input.sessionId.length > 64) {
    return { ok: false, reason: "invalid_session" };
  }

  const [link] = await db
    .select({
      id: customerStatusLinks.id,
      workspaceId: customerStatusLinks.workspaceId,
      dealRecordId: customerStatusLinks.dealRecordId,
      revokedAt: customerStatusLinks.revokedAt,
      expiresAt: customerStatusLinks.expiresAt,
      sentAt: customerStatusLinks.sentAt,
    })
    .from(customerStatusLinks)
    .where(eq(customerStatusLinks.token, token))
    .limit(1);
  if (!link) return { ok: false, reason: "not_found" };
  if (!isLinkUsable(link)) return { ok: false, reason: "revoked" };

  const openedAt = new Date();
  const audience = classifyPortalAudience({
    crmUserId: ctx.crmUserId ?? null,
    openedAt,
    sentAt: link.sentAt,
    sentSignalAvailable: true,
    channel: input.channel,
  });
  const activeDelta = clampMs(input.activeMsDelta);
  const visibleDelta = clampMs(input.visibleMsDelta);

  const inserted = await db
    .insert(customerPortalVisits)
    .values({
      customerLinkId: link.id,
      workspaceId: link.workspaceId,
      dealRecordId: link.dealRecordId,
      sessionId: input.sessionId,
      channel: input.channel?.slice(0, 32) ?? null,
      userAgent: ctx.userAgent.slice(0, 1000),
      ipAddress: ctx.ipAddress.slice(0, 200),
      referrer: input.referrer?.slice(0, 500) ?? null,
      isMobile: input.isMobile,
      stageAtOpen: input.stageAtOpen,
      activeMs: activeDelta,
      pageVisibleMs: visibleDelta,
      openedAt,
      isInternal: audience.internal,
      internalReason: audience.reason,
    })
    .onConflictDoNothing({
      target: [customerPortalVisits.customerLinkId, customerPortalVisits.sessionId],
    })
    .returning({ id: customerPortalVisits.id });

  const isNewSession = inserted.length > 0;
  if (!isNewSession) {
    await db
      .update(customerPortalVisits)
      .set({
        lastHeartbeatAt: new Date(),
        activeMs: sql`${customerPortalVisits.activeMs} + ${activeDelta}`,
        pageVisibleMs: sql`${customerPortalVisits.pageVisibleMs} + ${visibleDelta}`,
      })
      .where(
        and(
          eq(customerPortalVisits.customerLinkId, link.id),
          eq(customerPortalVisits.sessionId, input.sessionId)
        )
      );
  } else if (shouldRecordPortalOpenActivity({ isNewSession: true, internal: audience.internal })) {
    await emitEvent({
      workspaceId: link.workspaceId,
      recordId: link.dealRecordId,
      objectSlug: "deals",
      eventType: "customer.portal_opened",
      payload: {
        sessionId: input.sessionId,
        channel: input.channel,
        stageAtOpen: input.stageAtOpen,
      },
    });
  }

  await rollupCustomerSessions(link.id);
  return { ok: true };
}

/** Pre-0057 shape: no internal flag, no activity, no view_count rewrite. */
async function recordVisitBeaconLegacy(
  token: string,
  input: VisitBeaconInput,
  ctx: { ipAddress: string; userAgent: string }
): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (!validateTokenShape(token)) return { ok: false, reason: "invalid_token" };
  if (!input.sessionId || input.sessionId.length > 64) {
    return { ok: false, reason: "invalid_session" };
  }
  const [link] = await db
    .select({
      id: customerStatusLinks.id,
      workspaceId: customerStatusLinks.workspaceId,
      dealRecordId: customerStatusLinks.dealRecordId,
      revokedAt: customerStatusLinks.revokedAt,
      expiresAt: customerStatusLinks.expiresAt,
    })
    .from(customerStatusLinks)
    .where(eq(customerStatusLinks.token, token))
    .limit(1);
  if (!link) return { ok: false, reason: "not_found" };
  if (!isLinkUsable(link)) return { ok: false, reason: "revoked" };

  const activeDelta = clampMs(input.activeMsDelta);
  const visibleDelta = clampMs(input.visibleMsDelta);
  const [existing] = await db
    .select({ id: customerPortalVisits.id })
    .from(customerPortalVisits)
    .where(
      and(
        eq(customerPortalVisits.customerLinkId, link.id),
        eq(customerPortalVisits.sessionId, input.sessionId)
      )
    )
    .limit(1);

  if (existing) {
    await db
      .update(customerPortalVisits)
      .set({
        lastHeartbeatAt: new Date(),
        activeMs: sql`${customerPortalVisits.activeMs} + ${activeDelta}`,
        pageVisibleMs: sql`${customerPortalVisits.pageVisibleMs} + ${visibleDelta}`,
      })
      .where(eq(customerPortalVisits.id, existing.id));
  } else {
    await db.insert(customerPortalVisits).values({
      customerLinkId: link.id,
      workspaceId: link.workspaceId,
      dealRecordId: link.dealRecordId,
      sessionId: input.sessionId,
      channel: input.channel?.slice(0, 32) ?? null,
      userAgent: ctx.userAgent.slice(0, 1000),
      ipAddress: ctx.ipAddress.slice(0, 200),
      referrer: input.referrer?.slice(0, 500) ?? null,
      isMobile: input.isMobile,
      stageAtOpen: input.stageAtOpen,
      activeMs: activeDelta,
      pageVisibleMs: visibleDelta,
    });
  }

  const [agg] = await db
    .select({
      total: sql<number>`COALESCE(SUM(${customerPortalVisits.activeMs}), 0)::bigint`,
      sessions: sql<number>`COUNT(*)::int`,
    })
    .from(customerPortalVisits)
    .where(eq(customerPortalVisits.customerLinkId, link.id));

  await db
    .update(customerStatusLinks)
    .set({
      totalActiveMs: Number(agg?.total ?? 0),
      sessionCount: Number(agg?.sessions ?? 0),
      lastViewedAt: new Date(),
      firstViewedAt: sql`COALESCE(${customerStatusLinks.firstViewedAt}, NOW())`,
    })
    .where(eq(customerStatusLinks.id, link.id));

  return { ok: true };
}

export interface DocumentViewInput {
  token: string;
  documentId: string;
  method: string;
  userAgent: string | null;
  ipAddress: string;
  range: string | null;
  download: boolean;
  sessionId: string | null;
  crmUserId: string | null;
}

/** Record one PDF fetch. Never throws. Skips bots, HEAD, and range repeats. */
export async function recordPortalDocumentView(input: DocumentViewInput): Promise<void> {
  try {
    if (!shouldRecordPortalHit({ method: input.method, userAgent: input.userAgent })) return;
    if (!validateTokenShape(input.token)) return;

    const [link] = await db
      .select({
        id: customerStatusLinks.id,
        workspaceId: customerStatusLinks.workspaceId,
        dealRecordId: customerStatusLinks.dealRecordId,
        revokedAt: customerStatusLinks.revokedAt,
        expiresAt: customerStatusLinks.expiresAt,
        sentAt: customerStatusLinks.sentAt,
      })
      .from(customerStatusLinks)
      .where(eq(customerStatusLinks.token, input.token))
      .limit(1);
    if (!link || !isLinkUsable(link)) return;

    const [doc] = await db
      .select({
        fileName: dealDocuments.fileName,
        documentType: dealDocuments.documentType,
      })
      .from(dealDocuments)
      .where(
        and(
          eq(dealDocuments.id, input.documentId),
          eq(dealDocuments.dealRecordId, link.dealRecordId)
        )
      )
      .limit(1);
    if (!doc || !oeffentlichAbrufbar(doc.documentType)) return;

    const now = new Date();
    let sessionInternal: boolean | null = null;
    let sessionReason: InternalReason | null = null;
    if (input.sessionId) {
      const [visit] = await db
        .select({
          isInternal: customerPortalVisits.isInternal,
          internalReason: customerPortalVisits.internalReason,
        })
        .from(customerPortalVisits)
        .where(
          and(
            eq(customerPortalVisits.customerLinkId, link.id),
            eq(customerPortalVisits.sessionId, input.sessionId)
          )
        )
        .limit(1);
      if (visit) {
        sessionInternal = visit.isInternal;
        sessionReason = isInternalReason(visit.internalReason) ? visit.internalReason : null;
      }
    }

    const audience = documentAudience({
      request: {
        crmUserId: input.crmUserId,
        openedAt: now,
        sentAt: link.sentAt,
        sentSignalAvailable: true,
        channel: null,
      },
      sessionInternal,
      sessionReason,
    });

    const hasRange = !!input.range;
    if (hasRange) {
      const since = new Date(now.getTime() - DOCUMENT_VIEW_DEDUPE_MS);
      const sameViewer = input.sessionId
        ? eq(customerPortalDocumentViews.sessionId, input.sessionId)
        : eq(customerPortalDocumentViews.ipAddress, input.ipAddress.slice(0, 200));
      const [recent] = await db
        .select({ viewedAt: customerPortalDocumentViews.viewedAt })
        .from(customerPortalDocumentViews)
        .where(
          and(
            eq(customerPortalDocumentViews.customerLinkId, link.id),
            eq(customerPortalDocumentViews.documentId, input.documentId),
            sameViewer,
            gte(customerPortalDocumentViews.viewedAt, since)
          )
        )
        .orderBy(desc(customerPortalDocumentViews.viewedAt))
        .limit(1);
      if (
        shouldDedupeDocumentView({
          hasRange: true,
          lastViewedAt: asDate(recent?.viewedAt),
          now,
        })
      ) {
        return;
      }
    }

    const [prior] = await db
      .select({ n: sql<number>`COUNT(*)::int` })
      .from(customerPortalDocumentViews)
      .where(
        and(
          eq(customerPortalDocumentViews.customerLinkId, link.id),
          eq(customerPortalDocumentViews.documentId, input.documentId),
          eq(customerPortalDocumentViews.isInternal, false)
        )
      );
    const priorCustomerViews = Number(prior?.n ?? 0);
    const disposition = documentDisposition(input.download);

    await db.insert(customerPortalDocumentViews).values({
      customerLinkId: link.id,
      workspaceId: link.workspaceId,
      dealRecordId: link.dealRecordId,
      documentId: input.documentId,
      fileName: doc.fileName?.slice(0, 300) ?? null,
      documentType: doc.documentType,
      sessionId: input.sessionId,
      disposition,
      userAgent: (input.userAgent ?? "").slice(0, 1000),
      ipAddress: input.ipAddress.slice(0, 200),
      isInternal: audience.internal,
      internalReason: audience.reason,
      viewedAt: now,
    });

    if (
      shouldRecordDocumentActivity({
        internal: audience.internal,
        deduped: false,
        priorCustomerViews,
      })
    ) {
      await emitEvent({
        workspaceId: link.workspaceId,
        recordId: link.dealRecordId,
        objectSlug: "deals",
        eventType: "customer.document_viewed",
        payload: {
          documentId: input.documentId,
          fileName: doc.fileName ?? null,
          documentType: doc.documentType,
          disposition,
          sessionId: input.sessionId,
        },
      });
    }
  } catch (err) {
    if (!schemaNotReady(err)) console.error("[portal-tracking] document view", err);
  }
}

/**
 * Stamp sent_at the first time this deal's portal token shows up in an
 * outbound customer message. Safe to call on every send; does nothing when
 * the body has no token or the column is not migrated yet.
 */
export async function markCustomerLinkSentFromOutbound(input: {
  dealRecordId: string;
  body?: string | null;
  sentAt: Date;
}): Promise<void> {
  try {
    if (!input.dealRecordId || !input.body) return;
    const [link] = await db
      .select({
        id: customerStatusLinks.id,
        token: customerStatusLinks.token,
        sentAt: customerStatusLinks.sentAt,
      })
      .from(customerStatusLinks)
      .where(eq(customerStatusLinks.dealRecordId, input.dealRecordId))
      .limit(1);
    if (!link) return;
    if (!bodyContainsPortalToken(input.body, link.token)) return;
    if (link.sentAt && link.sentAt.getTime() <= input.sentAt.getTime()) return;
    await db
      .update(customerStatusLinks)
      .set({ sentAt: input.sentAt })
      .where(
        and(
          eq(customerStatusLinks.id, link.id),
          sql`(${customerStatusLinks.sentAt} IS NULL OR ${customerStatusLinks.sentAt} > ${input.sentAt})`
        )
      );
  } catch (err) {
    if (!schemaNotReady(err)) console.error("[portal-tracking] sent_at", err);
  }
}

export async function loadVisitTelemetry(
  workspaceId: string,
  dealRecordId: string
): Promise<VisitTelemetry | null> {
  try {
    return await loadVisitTelemetryCurrent(workspaceId, dealRecordId);
  } catch (err) {
    if (!schemaNotReady(err)) {
      console.error("[portal-tracking] telemetry", err);
      return null;
    }
    try {
      return await loadVisitTelemetryLegacy(workspaceId, dealRecordId);
    } catch (legacyErr) {
      console.error("[portal-tracking] telemetry legacy", legacyErr);
      return null;
    }
  }
}

async function loadVisitTelemetryCurrent(
  workspaceId: string,
  dealRecordId: string
): Promise<VisitTelemetry | null> {
  const [link] = await db
    .select({
      id: customerStatusLinks.id,
      sentAt: customerStatusLinks.sentAt,
    })
    .from(customerStatusLinks)
    .where(
      and(
        eq(customerStatusLinks.workspaceId, workspaceId),
        eq(customerStatusLinks.dealRecordId, dealRecordId)
      )
    )
    .limit(1);
  if (!link) return null;

  const [agg] = await db
    .select({
      sessions: sql<number>`COUNT(*) FILTER (WHERE ${customerPortalVisits.isInternal} = false)::int`,
      internalSessions: sql<number>`COUNT(*) FILTER (WHERE ${customerPortalVisits.isInternal} = true)::int`,
      total: sql<number>`COALESCE(SUM(${customerPortalVisits.activeMs}) FILTER (WHERE ${customerPortalVisits.isInternal} = false), 0)::bigint`,
      first: sql<Date | null>`MIN(${customerPortalVisits.openedAt}) FILTER (WHERE ${customerPortalVisits.isInternal} = false)`,
      last: sql<Date | null>`MAX(${customerPortalVisits.lastHeartbeatAt}) FILTER (WHERE ${customerPortalVisits.isInternal} = false)`,
    })
    .from(customerPortalVisits)
    .where(eq(customerPortalVisits.customerLinkId, link.id));

  const recent = await db
    .select({
      sessionId: customerPortalVisits.sessionId,
      openedAt: customerPortalVisits.openedAt,
      lastHeartbeatAt: customerPortalVisits.lastHeartbeatAt,
      activeMs: customerPortalVisits.activeMs,
      channel: customerPortalVisits.channel,
      isMobile: customerPortalVisits.isMobile,
      stageAtOpen: customerPortalVisits.stageAtOpen,
      isInternal: customerPortalVisits.isInternal,
      internalReason: customerPortalVisits.internalReason,
    })
    .from(customerPortalVisits)
    .where(eq(customerPortalVisits.customerLinkId, link.id))
    .orderBy(desc(customerPortalVisits.openedAt))
    .limit(12);

  const documents = await loadDocumentAggregates(link.id);

  const first = asDate(agg?.first);
  const last = asDate(agg?.last);
  return {
    sessionCount: Number(agg?.sessions ?? 0),
    internalSessionCount: Number(agg?.internalSessions ?? 0),
    totalActiveMs: Number(agg?.total ?? 0),
    firstViewedAt: first?.toISOString() ?? null,
    lastViewedAt: last?.toISOString() ?? null,
    sentAt: link.sentAt?.toISOString() ?? null,
    sentSignalAvailable: true,
    recent: recent.map((row) => {
      const reason = isInternalReason(row.internalReason) ? row.internalReason : null;
      return {
        sessionId: row.sessionId,
        openedAt: row.openedAt.toISOString(),
        lastHeartbeatAt: row.lastHeartbeatAt.toISOString(),
        activeMs: row.activeMs,
        channel: row.channel,
        isMobile: row.isMobile,
        stageAtOpen: row.stageAtOpen,
        internal: row.isInternal,
        internalLabel: row.isInternal ? internalVisitLabel(reason ?? "crm_session") : null,
      };
    }),
    documents,
  };
}

async function loadDocumentAggregates(linkId: string): Promise<DocumentViewAggregate[]> {
  try {
    const rows = await db
      .select({
        documentId: customerPortalDocumentViews.documentId,
        fileName: sql<string | null>`MAX(${customerPortalDocumentViews.fileName})`,
        documentType: sql<string | null>`MAX(${customerPortalDocumentViews.documentType})`,
        viewCount: sql<number>`COUNT(*) FILTER (WHERE ${customerPortalDocumentViews.isInternal} = false)::int`,
        internalViewCount: sql<number>`COUNT(*) FILTER (WHERE ${customerPortalDocumentViews.isInternal} = true)::int`,
        firstViewedAt: sql<Date | null>`MIN(${customerPortalDocumentViews.viewedAt}) FILTER (WHERE ${customerPortalDocumentViews.isInternal} = false)`,
        lastViewedAt: sql<Date | null>`MAX(${customerPortalDocumentViews.viewedAt}) FILTER (WHERE ${customerPortalDocumentViews.isInternal} = false)`,
      })
      .from(customerPortalDocumentViews)
      .where(eq(customerPortalDocumentViews.customerLinkId, linkId))
      .groupBy(customerPortalDocumentViews.documentId)
      .orderBy(sql`MIN(${customerPortalDocumentViews.viewedAt})`);

    return rows.map((row) => ({
      documentId: row.documentId,
      fileName: row.fileName,
      documentType: row.documentType,
      viewCount: Number(row.viewCount ?? 0),
      internalViewCount: Number(row.internalViewCount ?? 0),
      firstViewedAt: asDate(row.firstViewedAt)?.toISOString() ?? null,
      lastViewedAt: asDate(row.lastViewedAt)?.toISOString() ?? null,
    }));
  } catch (err) {
    if (!schemaNotReady(err)) console.error("[portal-tracking] document aggregates", err);
    return [];
  }
}

async function loadVisitTelemetryLegacy(
  workspaceId: string,
  dealRecordId: string
): Promise<VisitTelemetry | null> {
  const [link] = await db
    .select({
      id: customerStatusLinks.id,
      firstViewedAt: customerStatusLinks.firstViewedAt,
      lastViewedAt: customerStatusLinks.lastViewedAt,
      sessionCount: customerStatusLinks.sessionCount,
      totalActiveMs: customerStatusLinks.totalActiveMs,
    })
    .from(customerStatusLinks)
    .where(
      and(
        eq(customerStatusLinks.workspaceId, workspaceId),
        eq(customerStatusLinks.dealRecordId, dealRecordId)
      )
    )
    .limit(1);
  if (!link) return null;

  const recent = await db
    .select({
      sessionId: customerPortalVisits.sessionId,
      openedAt: customerPortalVisits.openedAt,
      lastHeartbeatAt: customerPortalVisits.lastHeartbeatAt,
      activeMs: customerPortalVisits.activeMs,
      channel: customerPortalVisits.channel,
      isMobile: customerPortalVisits.isMobile,
      stageAtOpen: customerPortalVisits.stageAtOpen,
    })
    .from(customerPortalVisits)
    .where(eq(customerPortalVisits.customerLinkId, link.id))
    .orderBy(desc(customerPortalVisits.openedAt))
    .limit(10);

  return {
    sessionCount: link.sessionCount,
    internalSessionCount: 0,
    totalActiveMs: Number(link.totalActiveMs ?? 0),
    firstViewedAt: link.firstViewedAt?.toISOString() ?? null,
    lastViewedAt: link.lastViewedAt?.toISOString() ?? null,
    sentAt: null,
    sentSignalAvailable: false,
    recent: recent.map((row) => ({
      sessionId: row.sessionId,
      openedAt: row.openedAt.toISOString(),
      lastHeartbeatAt: row.lastHeartbeatAt.toISOString(),
      activeMs: row.activeMs,
      channel: row.channel,
      isMobile: row.isMobile,
      stageAtOpen: row.stageAtOpen,
      internal: false,
      internalLabel: null,
    })),
    documents: [],
  };
}

async function rollupCustomerSessions(linkId: string): Promise<void> {
  const [agg] = await db
    .select({
      sessions: sql<number>`COUNT(*) FILTER (WHERE ${customerPortalVisits.isInternal} = false)::int`,
      total: sql<number>`COALESCE(SUM(${customerPortalVisits.activeMs}) FILTER (WHERE ${customerPortalVisits.isInternal} = false), 0)::bigint`,
      first: sql<Date | null>`MIN(${customerPortalVisits.openedAt}) FILTER (WHERE ${customerPortalVisits.isInternal} = false)`,
      last: sql<Date | null>`MAX(${customerPortalVisits.lastHeartbeatAt}) FILTER (WHERE ${customerPortalVisits.isInternal} = false)`,
    })
    .from(customerPortalVisits)
    .where(eq(customerPortalVisits.customerLinkId, linkId));

  await db
    .update(customerStatusLinks)
    .set({
      viewCount: Number(agg?.sessions ?? 0),
      sessionCount: Number(agg?.sessions ?? 0),
      totalActiveMs: Number(agg?.total ?? 0),
      firstViewedAt: asDate(agg?.first),
      lastViewedAt: asDate(agg?.last),
    })
    .where(eq(customerStatusLinks.id, linkId));
}

function isLinkUsable(link: { revokedAt: Date | null; expiresAt?: Date | null }, now = new Date()): boolean {
  if (link.revokedAt) return false;
  if (link.expiresAt != null && link.expiresAt < now) return false;
  return true;
}

function clampMs(n: number): number {
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(Math.floor(n), 10 * 60 * 1000);
}

function asDate(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function isInternalReason(value: string | null): value is InternalReason {
  return value === "crm_session" || value === "pre_send" || value === "share_panel";
}

export function schemaNotReady(err: unknown): boolean {
  const seen = new Set<unknown>();
  let current: unknown = err;
  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    const rec = current as { code?: unknown; message?: unknown; cause?: unknown };
    const code = typeof rec.code === "string" ? rec.code : "";
    const message = typeof rec.message === "string" ? rec.message : "";
    const missing =
      code === "42P01" || code === "42703" || /does not exist/i.test(message);
    if (
      missing &&
      /customer_portal_document_views|sent_at|is_internal|internal_reason/i.test(message)
    ) {
      return true;
    }
    current = rec.cause;
  }
  return false;
}

async function awaitTracking<T>(work: Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), ms);
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
    void work.catch((err) => console.error("[portal-tracking]", err));
  }
}

export async function awaitPortalTracking<T>(work: Promise<T>): Promise<T | null> {
  return awaitTracking(work, TRACK_TIMEOUT_MS);
}
