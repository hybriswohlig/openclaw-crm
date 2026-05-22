/**
 * Customer-portal data adapter.
 *
 * SEPARATION BOUNDARY.
 *
 * The public API routes under app/api/public/[token]/* call ONLY this module.
 * No other CRM service is imported there. That means the day the customer
 * portal is lifted into its own repo / Vercel project, the work is:
 *
 *   1. Move app/api/public/* and app/(public)/* to the new app.
 *   2. Replace this file with a thin HTTP client that calls the CRM's same
 *      `/api/public/[token]/state` endpoint.
 *   3. (Optionally) replicate the four `customer_*` tables to a portal-owned DB
 *      and keep the adapter local; the API contract stays unchanged.
 *
 * Therefore: nothing in this module should leak Drizzle types upstream.
 * Outputs are the portable shapes from `@openclaw-crm/customer-portal-core`.
 */

import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  customerStatusLinks,
  kvaConfirmations,
  moveTimeEntries,
  customerEmployeeRatings,
  operatingCompanyPortalSettings,
} from "@/db/schema/customer-portal";
import { quotations, quotationLineItems } from "@/db/schema/quotations";
import { dealDocuments, payments, dealNumbers } from "@/db/schema/financial";
import { dealEmployees, employees } from "@/db/schema/employees";
import { objects, attributes, selectOptions } from "@/db/schema/objects";
import { records, recordValues } from "@/db/schema/records";
import { inboxMessageAttachments, inboxMessages } from "@/db/schema/inbox";
import {
  buildGirocodePayload,
  buildPayPalUrl,
  deriveStage,
  generateToken,
  validateTokenShape,
  widerrufVerzichtRequired,
  type AcceptanceRecord,
  type AttachmentRef,
  type ConfirmKvaPayload,
  type CrewMember,
  type CustomerPortalContext,
  type FirmaBranding,
  type KvaLineItem,
  type KvaSnapshot,
  type MoveScope,
  type MoveTiming,
  type OfferInclusions,
  type PaymentInstructions,
  type PaymentMethodPreference,
} from "@openclaw-crm/customer-portal-core";
import { loadEffectiveBranding } from "./customer-portal-config";
import { emitEvent } from "./activity-events";
import { sendKvaAcceptanceEmail } from "./customer-portal-emails";

// ─── Token / link lifecycle ────────────────────────────────────────────────────

export interface CreateLinkInput {
  workspaceId: string;
  dealRecordId: string;
  createdBy: string | null;
}

export interface EnsureLinkResult {
  token: string | null;
  created: boolean;
  /** True when the deal's operating company has the portal feature switched off. */
  skipped: boolean;
}

/**
 * Idempotent: returns the existing link's token if one already exists for
 * the deal, otherwise creates a new row with a fresh token.
 *
 * Respects the per-operating-company `enabled` flag — if the OC has the
 * portal feature switched off in settings, returns `{ skipped: true }`
 * without creating anything. Existing links are not deleted on disable;
 * they stay revocable from the share panel.
 */
export async function ensureCustomerStatusLink(
  input: CreateLinkInput
): Promise<EnsureLinkResult> {
  const existing = await db
    .select({ token: customerStatusLinks.token })
    .from(customerStatusLinks)
    .where(eq(customerStatusLinks.dealRecordId, input.dealRecordId))
    .limit(1);

  if (existing.length > 0) {
    return { token: existing[0].token, created: false, skipped: false };
  }

  // Block link creation for deals whose operating company has the feature off.
  const dealAttrs = await loadDealAttributeMap(input.workspaceId);
  const dealValues = await loadValuesForRecord(input.dealRecordId);
  const ocId = await refValue(dealValues, dealAttrs.bySlug.get("operating_company")?.id);
  const effective = await loadEffectiveBranding(ocId);
  if (!effective.enabled) {
    return { token: null, created: false, skipped: true };
  }

  const token = await generateToken();
  await db.insert(customerStatusLinks).values({
    workspaceId: input.workspaceId,
    dealRecordId: input.dealRecordId,
    token,
    createdBy: input.createdBy,
  });
  return { token, created: true, skipped: false };
}

export async function revokeCustomerStatusLink(token: string): Promise<void> {
  if (!validateTokenShape(token)) return;
  await db
    .update(customerStatusLinks)
    .set({ revokedAt: new Date() })
    .where(eq(customerStatusLinks.token, token));
}

/**
 * Resolve which origin the public-facing URL for a given deal should use.
 *
 * Priority:
 *   1) Per-OC `customDomain` once `domainVerificationState === 'verified'` —
 *      this is the customer-facing brand the operator wants.
 *   2) `NEXT_PUBLIC_APP_URL` — the workspace-wide fallback (set in Vercel env).
 *   3) Best-effort default of the vercel deployment URL.
 *
 * Returns the bare origin without a trailing slash so the caller can append
 * `/s/<token>` directly.
 */
export async function resolveCustomerLinkOrigin(
  dealRecordId: string,
  workspaceId: string,
  envFallback: string | null
): Promise<string> {
  const dealAttrs = await loadDealAttributeMap(workspaceId);
  const dealValues = await loadValuesForRecord(dealRecordId);
  const ocId = await refValue(dealValues, dealAttrs.bySlug.get("operating_company")?.id);
  if (ocId) {
    const [s] = await db
      .select({
        customDomain: operatingCompanyPortalSettings.customDomain,
        state: operatingCompanyPortalSettings.domainVerificationState,
      })
      .from(operatingCompanyPortalSettings)
      .where(eq(operatingCompanyPortalSettings.operatingCompanyRecordId, ocId))
      .limit(1);
    if (s?.customDomain && s.state === "verified") {
      return `https://${s.customDomain}`;
    }
  }
  if (envFallback) return envFallback.replace(/\/+$/, "");
  return "https://openclaw-crm-web.vercel.app";
}

/**
 * Increments view counters. Fire-and-forget — never blocks rendering.
 */
export async function bumpView(token: string): Promise<void> {
  if (!validateTokenShape(token)) return;
  const now = new Date();
  await db
    .update(customerStatusLinks)
    .set({
      viewCount: sql`${customerStatusLinks.viewCount} + 1`,
      lastViewedAt: now,
      firstViewedAt: sql`COALESCE(${customerStatusLinks.firstViewedAt}, ${now})`,
    })
    .where(eq(customerStatusLinks.token, token))
    .catch(() => {});
}

// ─── Context load ──────────────────────────────────────────────────────────────

/**
 * Returns the full portable context for a given token, or null if the token
 * doesn't exist. If the link is revoked / expired, returns a context with
 * `meta.revoked = true` so the UI can render a friendly message.
 *
 * This is the heaviest read of the portal — it intentionally fans out into
 * many small queries to keep each one indexed and fast. A future optimisation
 * is to collapse them into a single SQL with CTEs once we know the access
 * pattern is stable.
 */
export async function loadContextByToken(
  token: string
): Promise<CustomerPortalContext | null> {
  if (!validateTokenShape(token)) return null;

  const [link] = await db
    .select()
    .from(customerStatusLinks)
    .where(eq(customerStatusLinks.token, token))
    .limit(1);

  if (!link) return null;

  const now = new Date();
  const revoked =
    !!link.revokedAt || (link.expiresAt != null && link.expiresAt < now);

  const workspaceId = link.workspaceId;
  const dealRecordId = link.dealRecordId;

  // Deal fields
  const dealAttrs = await loadDealAttributeMap(workspaceId);
  const dealValues = await loadValuesForRecord(dealRecordId);

  const scope = projectMoveScope(dealAttrs, dealValues);
  const operatingCompanyId = dealAttrs.byId.has(dealAttrs.bySlug.get("operating_company")?.id ?? "")
    ? null
    : await refValue(dealValues, dealAttrs.bySlug.get("operating_company")?.id);
  const ocId = await refValue(dealValues, dealAttrs.bySlug.get("operating_company")?.id);
  void operatingCompanyId; // silence unused

  // Per-OC branding + enabled flag come from the DB. The fallback to stamm.ts
  // constants happens inside loadEffectiveBranding for any unconfigured firma.
  const effective = await loadEffectiveBranding(ocId);
  const branding: FirmaBranding = effective.branding;

  // Customer display name from associated_people (first only, lightweight)
  const customerDisplayName = await loadCustomerDisplayName(dealValues, dealAttrs);

  // Deal number
  const [dealNumberRow] = await db
    .select({ dealNumber: dealNumbers.dealNumber })
    .from(dealNumbers)
    .where(eq(dealNumbers.dealRecordId, dealRecordId))
    .limit(1);
  const dealNumber = dealNumberRow?.dealNumber ?? dealRecordId.slice(0, 8);

  // Quotation + line items
  const kva = await loadKvaSnapshot(dealRecordId);

  // Crew
  const crew = await loadCrew(dealRecordId);

  // Offer inclusions (derived from the linked auftrag, plus a baseline of
  // always-included services every move gets).
  const inclusions = await loadInclusions(workspaceId, dealRecordId);

  // Confirmation
  const acceptance = await loadLatestAcceptance(dealRecordId);

  // Documents (presence only — the public route streams them through a scoped URL)
  const docRows = await db
    .select({ id: dealDocuments.id, type: dealDocuments.documentType })
    .from(dealDocuments)
    .where(
      and(
        eq(dealDocuments.workspaceId, workspaceId),
        eq(dealDocuments.dealRecordId, dealRecordId)
      )
    );
  const orderConfirmationDoc = docRows.find((d) => d.type === "order_confirmation");
  const invoiceDoc = docRows.find((d) => d.type === "invoice");

  // Move timing
  const [timingRow] = await db
    .select()
    .from(moveTimeEntries)
    .where(eq(moveTimeEntries.dealRecordId, dealRecordId))
    .limit(1);
  const timing: MoveTiming = {
    departureAt: timingRow?.departureAt?.toISOString() ?? null,
    onsiteAt: timingRow?.onsiteAt?.toISOString() ?? null,
    finishedAt: timingRow?.finishedAt?.toISOString() ?? null,
  };

  // Sum of confirmed payments — used for Anzahlung gating.
  const paymentRows = await db
    .select({ amount: payments.amount })
    .from(payments)
    .where(eq(payments.dealRecordId, dealRecordId));
  const paymentsReceivedCents = paymentRows.reduce(
    (s, r) => s + Math.round(Number(r.amount) * 100),
    0
  );

  // Stage derivation
  const stage = deriveStage({
    hasInvoice: !!invoiceDoc,
    hasOrderConfirmation: !!orderConfirmationDoc,
    moveDate: scope.moveDate,
    departureAt: timingRow?.departureAt ?? null,
    finishedAt: timingRow?.finishedAt ?? null,
    depositRequiredCents: kva?.depositRequiredCents ?? null,
    paymentsReceivedCents,
    kvaAccepted: !!acceptance,
    now,
  });

  // Attachments (only fetched when stage >= 3 to keep Stage-1 fast).
  const attachments = stage >= 3 ? await loadAttachments(workspaceId, dealRecordId, scope.moveDate) : [];

  // Payment instructions are computed when:
  //   - Stage 4 (Rechnung-Zahlung), OR
  //   - Stage 1 with a deposit required.
  let payment: PaymentInstructions | null = null;
  const quotationMethod = await loadPaymentMethodPreference(dealRecordId);
  if (stage === 4 && kva) {
    payment = buildPaymentInstructions({
      method: quotationMethod,
      amountCents: Math.max(0, kva.totalCents - paymentsReceivedCents),
      reference: `Rechnung ${dealNumber}`,
      branding,
    });
  } else if (stage === 1 && kva?.depositRequiredCents && kva.depositRequiredCents > 0) {
    payment = buildPaymentInstructions({
      method: quotationMethod,
      amountCents: Math.max(0, kva.depositRequiredCents - paymentsReceivedCents),
      reference: `Anzahlung ${dealNumber}`,
      branding,
    });
  }

  return {
    stage,
    dealNumber,
    customerDisplayName,
    branding,
    scope,
    inclusions,
    crew,
    kva,
    acceptance,
    documents: {
      orderConfirmationUrl: orderConfirmationDoc
        ? `/api/public/${token}/documents/${orderConfirmationDoc.id}`
        : null,
      invoiceUrl: invoiceDoc ? `/api/public/${token}/documents/${invoiceDoc.id}` : null,
    },
    attachments,
    timing,
    payment,
    meta: {
      serverTime: now.toISOString(),
      revoked,
      featureDisabled: !effective.enabled,
      canonicalHost: effective.customDomain,
    },
  };
}

// ─── Confirm KVA ───────────────────────────────────────────────────────────────

export interface ConfirmKvaContext {
  ipAddress: string;
  userAgent: string;
}

export async function confirmKvaForToken(
  token: string,
  body: ConfirmKvaPayload,
  ctx: ConfirmKvaContext
): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (!validateTokenShape(token)) return { ok: false, reason: "invalid_token" };

  const [link] = await db
    .select()
    .from(customerStatusLinks)
    .where(eq(customerStatusLinks.token, token))
    .limit(1);

  if (!link) return { ok: false, reason: "not_found" };
  if (link.revokedAt) return { ok: false, reason: "revoked" };

  // Re-validate gates server-side so the client can't lie.
  if (!body.acceptedOffer || !body.acceptedBindingNature) {
    return { ok: false, reason: "missing_acknowledgement" };
  }

  const kva = await loadKvaSnapshot(link.dealRecordId);
  if (!kva) return { ok: false, reason: "no_quotation" };

  const dealAttrs = await loadDealAttributeMap(link.workspaceId);
  const dealValues = await loadValuesForRecord(link.dealRecordId);
  const scope = projectMoveScope(dealAttrs, dealValues);
  if (widerrufVerzichtRequired(scope.moveDate, new Date()) && !body.widerrufVerzichtAccepted) {
    return { ok: false, reason: "widerruf_required" };
  }

  const ocId = await refValue(dealValues, dealAttrs.bySlug.get("operating_company")?.id);
  const effective = await loadEffectiveBranding(ocId);
  if (!effective.enabled) {
    return { ok: false, reason: "feature_disabled" };
  }

  const signedAt = new Date();
  await db.insert(kvaConfirmations).values({
    workspaceId: link.workspaceId,
    dealRecordId: link.dealRecordId,
    customerLinkId: link.id,
    quotationSnapshot: kva,
    confirmedTotalCents: kva.totalCents,
    agbVersionAccepted: effective.branding.agbVersion,
    widerrufVerzichtAccepted: body.widerrufVerzichtAccepted,
    ipAddress: ctx.ipAddress.slice(0, 200),
    userAgent: ctx.userAgent.slice(0, 1000),
    acceptedFullName: body.fullName ?? null,
    signedAt,
  });

  // Fire-and-forget confirmation email. Never throws — failures log + drop.
  void sendKvaAcceptanceEmail({
    workspaceId: link.workspaceId,
    dealRecordId: link.dealRecordId,
    customerLinkId: link.id,
    acceptedFullName: body.fullName ?? null,
    widerrufVerzichtAccepted: body.widerrufVerzichtAccepted,
    snapshot: kva,
    signedAt: signedAt.toISOString(),
  }).catch((err) => {
    console.error("[customer-portal] email dispatch failed:", err);
  });

  await emitEvent({
    workspaceId: link.workspaceId,
    recordId: link.dealRecordId,
    objectSlug: "deals",
    eventType: "customer.kva_confirmed",
    payload: {
      confirmedTotalCents: kva.totalCents,
      agbVersion: effective.branding.agbVersion,
      acceptedFullName: body.fullName ?? null,
      widerrufVerzichtAccepted: body.widerrufVerzichtAccepted,
      ipAddress: ctx.ipAddress.slice(0, 200),
    },
  });

  return { ok: true };
}

/**
 * "Ich habe bezahlt" — customer-side soft acknowledgement. Does NOT write a
 * payments row (operator does that after bank reconciliation). Emits an
 * activity event so the operator sees it on the deal timeline + can pick up
 * the work.
 */
export async function recordMarkedPaid(
  token: string,
  body: { method: string; amountCents: number; variant: "deposit" | "final" },
  ctx: { ipAddress: string; userAgent: string }
): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (!validateTokenShape(token)) return { ok: false, reason: "invalid_token" };
  const [link] = await db
    .select()
    .from(customerStatusLinks)
    .where(eq(customerStatusLinks.token, token))
    .limit(1);
  if (!link) return { ok: false, reason: "not_found" };
  if (link.revokedAt) return { ok: false, reason: "revoked" };

  await emitEvent({
    workspaceId: link.workspaceId,
    recordId: link.dealRecordId,
    objectSlug: "deals",
    eventType: "customer.marked_paid",
    payload: {
      method: body.method,
      amountCents: body.amountCents,
      variant: body.variant,
      ipAddress: ctx.ipAddress.slice(0, 200),
      userAgent: ctx.userAgent.slice(0, 200),
    },
  });

  return { ok: true };
}

/**
 * Stage-4 crew rating. Upserts on (dealRecordId, employeeId) so a customer
 * can revise a star count if they tap again. Server validates 1-5.
 */
export async function recordCrewRatings(
  token: string,
  ratings: Array<{ employeeId: string; stars: number; comment: string | null }>,
  ctx: { ipAddress: string }
): Promise<{ ok: true; count: number } | { ok: false; reason: string }> {
  if (!validateTokenShape(token)) return { ok: false, reason: "invalid_token" };
  const [link] = await db
    .select()
    .from(customerStatusLinks)
    .where(eq(customerStatusLinks.token, token))
    .limit(1);
  if (!link) return { ok: false, reason: "not_found" };
  if (link.revokedAt) return { ok: false, reason: "revoked" };

  // Only persist ratings whose employee is actually assigned to this deal.
  const assigned = await db
    .select({ employeeId: dealEmployees.employeeId })
    .from(dealEmployees)
    .where(eq(dealEmployees.dealRecordId, link.dealRecordId));
  const valid = new Set(assigned.map((a) => a.employeeId));

  let written = 0;
  for (const r of ratings) {
    if (!valid.has(r.employeeId)) continue;
    if (!Number.isInteger(r.stars) || r.stars < 1 || r.stars > 5) continue;
    // Upsert via two-step (no Drizzle helper for ON CONFLICT on a compound
    // unique index here — write fresh, delete prior first).
    await db
      .delete(customerEmployeeRatings)
      .where(
        and(
          eq(customerEmployeeRatings.dealRecordId, link.dealRecordId),
          eq(customerEmployeeRatings.employeeId, r.employeeId)
        )
      );
    await db.insert(customerEmployeeRatings).values({
      workspaceId: link.workspaceId,
      dealRecordId: link.dealRecordId,
      employeeId: r.employeeId,
      stars: r.stars,
      comment: r.comment ?? null,
      ipAddress: ctx.ipAddress.slice(0, 200),
    });
    written++;
  }

  if (written > 0) {
    await emitEvent({
      workspaceId: link.workspaceId,
      recordId: link.dealRecordId,
      objectSlug: "deals",
      eventType: "customer.rated_crew",
      payload: {
        ratings: ratings
          .filter((r) => valid.has(r.employeeId) && r.stars >= 1 && r.stars <= 5)
          .map((r) => ({ employeeId: r.employeeId, stars: r.stars })),
      },
    });
  }

  return { ok: true, count: written };
}

// ─── Document streaming (token-scoped guard) ───────────────────────────────────

/**
 * Resolves a document id under the token's deal scope. Returns null if the
 * document doesn't belong to the deal of this token, so the public route can
 * safely 404 without leaking existence.
 */
export async function getScopedDocument(
  token: string,
  documentId: string
): Promise<{ mimeType: string; fileName: string; fileContent: string } | null> {
  if (!validateTokenShape(token)) return null;

  const [link] = await db
    .select({ dealRecordId: customerStatusLinks.dealRecordId, revokedAt: customerStatusLinks.revokedAt })
    .from(customerStatusLinks)
    .where(eq(customerStatusLinks.token, token))
    .limit(1);
  if (!link || link.revokedAt) return null;

  const [doc] = await db
    .select({
      mimeType: dealDocuments.mimeType,
      fileName: dealDocuments.fileName,
      fileContent: dealDocuments.fileContent,
    })
    .from(dealDocuments)
    .where(
      and(
        eq(dealDocuments.id, documentId),
        eq(dealDocuments.dealRecordId, link.dealRecordId)
      )
    )
    .limit(1);

  return doc ?? null;
}

export async function getScopedAttachment(
  token: string,
  attachmentId: string
): Promise<{ mimeType: string; fileName: string; fileContent: string } | null> {
  if (!validateTokenShape(token)) return null;

  const [link] = await db
    .select({ dealRecordId: customerStatusLinks.dealRecordId, revokedAt: customerStatusLinks.revokedAt })
    .from(customerStatusLinks)
    .where(eq(customerStatusLinks.token, token))
    .limit(1);
  if (!link || link.revokedAt) return null;

  const [att] = await db
    .select({
      mimeType: inboxMessageAttachments.mimeType,
      fileName: inboxMessageAttachments.fileName,
      fileContent: inboxMessageAttachments.fileContent,
    })
    .from(inboxMessageAttachments)
    .where(
      and(
        eq(inboxMessageAttachments.id, attachmentId),
        eq(inboxMessageAttachments.dealRecordId, link.dealRecordId)
      )
    )
    .limit(1);

  return att ?? null;
}

// ─── Helpers (kept internal — never imported outside this file) ────────────────

interface DealAttrIndex {
  bySlug: Map<string, { id: string; type: string }>;
  byId: Map<string, { id: string; type: string; slug: string }>;
}

async function loadDealAttributeMap(workspaceId: string): Promise<DealAttrIndex> {
  const [dealObj] = await db
    .select({ id: objects.id })
    .from(objects)
    .where(and(eq(objects.workspaceId, workspaceId), eq(objects.slug, "deals")))
    .limit(1);
  if (!dealObj) return { bySlug: new Map(), byId: new Map() };

  const attrs = await db
    .select({ id: attributes.id, slug: attributes.slug, type: attributes.type })
    .from(attributes)
    .where(eq(attributes.objectId, dealObj.id));

  const bySlug = new Map<string, { id: string; type: string }>();
  const byId = new Map<string, { id: string; type: string; slug: string }>();
  for (const a of attrs) {
    bySlug.set(a.slug, { id: a.id, type: a.type });
    byId.set(a.id, { id: a.id, type: a.type, slug: a.slug });
  }
  return { bySlug, byId };
}

type ValueRow = typeof recordValues.$inferSelect;

async function loadValuesForRecord(recordId: string): Promise<Map<string, ValueRow>> {
  const rows = await db
    .select()
    .from(recordValues)
    .where(eq(recordValues.recordId, recordId));
  const map = new Map<string, ValueRow>();
  for (const r of rows) map.set(r.attributeId, r);
  return map;
}

function projectMoveScope(
  dealAttrs: DealAttrIndex,
  values: Map<string, ValueRow>
): MoveScope {
  const get = (slug: string) => values.get(dealAttrs.bySlug.get(slug)?.id ?? "");
  return {
    moveDate: get("move_date")?.dateValue ?? null,
    timeStart: null,
    timeEnd: null,
    fromAddress: extractLocation(get("move_from_address")?.jsonValue),
    toAddress: extractLocation(get("move_to_address")?.jsonValue),
    floorsFrom: numOrNull(get("floors_from")?.numberValue),
    floorsTo: numOrNull(get("floors_to")?.numberValue),
    accessFrom: null,
    accessTo: null,
    volumeCbm: null,
    workerCount: null,
    transporterName: null,
    specialRequests: null,
    inventoryNotes: textOrNull(get("inventory_notes")?.textValue),
  };
}

function extractLocation(v: unknown): string | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const parts = [o.line1, o.postcode, o.city].filter(Boolean) as string[];
  return parts.length ? parts.join(", ") : textOrNull(o.line1);
}

function numOrNull(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function textOrNull(v: unknown): string | null {
  return typeof v === "string" && v.length ? v : null;
}

async function refValue(
  values: Map<string, ValueRow>,
  attrId: string | undefined
): Promise<string | null> {
  if (!attrId) return null;
  const v = values.get(attrId);
  return v?.referencedRecordId ?? null;
}

async function loadRecordNameText(recordId: string): Promise<string | null> {
  // Look up record's object → its `name` attribute → the value on this record.
  const [r] = await db.select({ objectId: records.objectId }).from(records).where(eq(records.id, recordId)).limit(1);
  if (!r) return null;
  const [nameAttr] = await db
    .select({ id: attributes.id })
    .from(attributes)
    .where(and(eq(attributes.objectId, r.objectId), eq(attributes.slug, "name")))
    .limit(1);
  if (!nameAttr) return null;
  const [val] = await db
    .select({ textValue: recordValues.textValue })
    .from(recordValues)
    .where(and(eq(recordValues.recordId, recordId), eq(recordValues.attributeId, nameAttr.id)))
    .limit(1);
  return val?.textValue ?? null;
}

async function loadCustomerDisplayName(
  values: Map<string, ValueRow>,
  dealAttrs: DealAttrIndex
): Promise<string | null> {
  const attr = dealAttrs.bySlug.get("associated_people");
  if (!attr) return null;
  const v = values.get(attr.id);
  if (!v?.referencedRecordId) return null;
  // For multi-select record references the schema stores one row per linked
  // record; we grab the first. Good enough for a customer headline.
  const name = await loadRecordNameText(v.referencedRecordId);
  if (name) return name;
  // Fallback: try the `name` (personal_name JSON) on the people record.
  return null;
}

async function loadKvaSnapshot(dealRecordId: string): Promise<KvaSnapshot | null> {
  const [q] = await db
    .select()
    .from(quotations)
    .where(eq(quotations.dealRecordId, dealRecordId))
    .limit(1);
  if (!q) return null;

  const lineItemRows = await db
    .select()
    .from(quotationLineItems)
    .where(eq(quotationLineItems.quotationId, q.id))
    .orderBy(quotationLineItems.sortOrder);

  const lineItems: KvaLineItem[] = lineItemRows.map((li) => {
    const unit = Number(li.unitRate);
    const total = roundCents(unit * li.quantity);
    return {
      type: li.type,
      description: li.description ?? "",
      quantity: li.quantity,
      unitRate: unit,
      lineTotal: total,
    };
  });

  let totalCents = 0;
  if (q.isVariable && lineItems.length > 0) {
    totalCents = lineItems.reduce((s, li) => s + toCents(li.lineTotal), 0);
  } else if (q.fixedPrice) {
    totalCents = toCents(Number(q.fixedPrice));
  }

  return {
    isVariable: q.isVariable,
    fixedPriceCents: q.fixedPrice ? toCents(Number(q.fixedPrice)) : null,
    lineItems,
    notes: q.notes ?? null,
    totalCents,
    depositRequiredCents: q.depositRequiredCents ?? null,
    validUntil: q.validUntil ?? null,
  };
}

async function loadPaymentMethodPreference(
  dealRecordId: string
): Promise<PaymentMethodPreference> {
  const [q] = await db
    .select({ method: quotations.paymentMethodPreference })
    .from(quotations)
    .where(eq(quotations.dealRecordId, dealRecordId))
    .limit(1);
  const m = q?.method;
  if (m === "bank_transfer" || m === "paypal" || m === "cash" || m === "card") return m;
  return "bank_transfer";
}

async function loadCrew(dealRecordId: string): Promise<CrewMember[]> {
  const rows = await db
    .select({
      employeeId: dealEmployees.employeeId,
      role: dealEmployees.role,
      name: employees.name,
      photoBase64: employees.photoBase64,
    })
    .from(dealEmployees)
    .innerJoin(employees, eq(employees.id, dealEmployees.employeeId))
    .where(eq(dealEmployees.dealRecordId, dealRecordId));

  return rows.map((r) => ({
    employeeId: r.employeeId,
    name: r.name,
    role: r.role,
    photoBase64DataUrl:
      r.photoBase64 && r.photoBase64.startsWith("data:")
        ? r.photoBase64
        : r.photoBase64
          ? `data:image/jpeg;base64,${r.photoBase64}`
          : null,
  }));
}

async function loadLatestAcceptance(
  dealRecordId: string
): Promise<AcceptanceRecord | null> {
  const [row] = await db
    .select()
    .from(kvaConfirmations)
    .where(eq(kvaConfirmations.dealRecordId, dealRecordId))
    .orderBy(desc(kvaConfirmations.signedAt))
    .limit(1);
  if (!row) return null;
  return {
    signedAt: row.signedAt.toISOString(),
    acceptedFullName: row.acceptedFullName,
    widerrufVerzichtAccepted: row.widerrufVerzichtAccepted,
    agbVersionAccepted: row.agbVersionAccepted,
  };
}

async function loadAttachments(
  workspaceId: string,
  dealRecordId: string,
  moveDateYmd: string | null
): Promise<AttachmentRef[]> {
  // For Stage 3: per the answered question, default visibility is
  //   - outbound: shown when sent on or after the move day
  //   - inbound:  never (customer's own pre-quote photos stay private)
  const rows = await db
    .select({
      id: inboxMessageAttachments.id,
      fileName: inboxMessageAttachments.fileName,
      mimeType: inboxMessageAttachments.mimeType,
      fileSize: inboxMessageAttachments.fileSize,
      createdAt: inboxMessageAttachments.createdAt,
      messageId: inboxMessageAttachments.messageId,
    })
    .from(inboxMessageAttachments)
    .where(
      and(
        eq(inboxMessageAttachments.workspaceId, workspaceId),
        eq(inboxMessageAttachments.dealRecordId, dealRecordId)
      )
    );
  if (rows.length === 0) return [];

  const messageIds = rows.map((r) => r.messageId);
  const messageRows = await db
    .select({
      id: inboxMessages.id,
      direction: inboxMessages.direction,
      body: inboxMessages.body,
      sentAt: inboxMessages.sentAt,
      createdAt: inboxMessages.createdAt,
    })
    .from(inboxMessages)
    .where(inArray(inboxMessages.id, messageIds));

  const byMsg = new Map(messageRows.map((m) => [m.id, m]));

  const moveStart = moveDateYmd ? new Date(`${moveDateYmd}T00:00:00+02:00`) : null;

  const out: AttachmentRef[] = [];
  for (const r of rows) {
    const m = byMsg.get(r.messageId);
    if (!m) continue;
    if (m.direction !== "outbound") continue;
    const ts = m.sentAt ?? m.createdAt ?? r.createdAt;
    if (moveStart && ts && ts < moveStart) continue;
    out.push({
      id: r.id,
      fileName: r.fileName,
      mimeType: r.mimeType,
      fileSize: r.fileSize,
      sentAt: (ts ?? r.createdAt).toISOString(),
      isImage: r.mimeType.startsWith("image/"),
      caption: m.body ?? "",
      direction: "outbound",
    });
  }
  out.sort((a, b) => a.sentAt.localeCompare(b.sentAt));
  return out;
}

function buildPaymentInstructions(args: {
  method: PaymentMethodPreference;
  amountCents: number;
  reference: string;
  branding: FirmaBranding;
}): PaymentInstructions {
  const { method, amountCents, reference, branding } = args;
  if (method === "bank_transfer" && branding.bank.iban) {
    return {
      method: "bank_transfer",
      amountCents,
      reference,
      bank: {
        iban: branding.bank.iban,
        bic: branding.bank.bic ?? "",
        holder: branding.bank.holder ?? branding.displayName,
      },
      paypalUrl: null,
      girocodePayload: buildGirocodePayload({
        beneficiaryName: branding.bank.holder ?? branding.displayName,
        iban: branding.bank.iban,
        bic: branding.bank.bic,
        amountCents,
        remittance: reference,
      }),
    };
  }
  if (method === "paypal" && branding.paypal.handleOrEmail) {
    return {
      method: "paypal",
      amountCents,
      reference,
      bank: null,
      paypalUrl: buildPayPalUrl({
        handleOrEmail: branding.paypal.handleOrEmail,
        amountCents,
        reference,
      }),
      girocodePayload: null,
    };
  }
  if (method === "cash") {
    return { method, amountCents, reference, bank: null, paypalUrl: null, girocodePayload: null };
  }
  if (method === "card") {
    return { method, amountCents, reference, bank: null, paypalUrl: null, girocodePayload: null };
  }
  // Fallback: bank_transfer without IBAN — still rendered, customer sees a note
  return {
    method: "bank_transfer",
    amountCents,
    reference,
    bank: null,
    paypalUrl: null,
    girocodePayload: null,
  };
}

function toCents(eur: number): number {
  return Math.round(eur * 100);
}

function roundCents(eur: number): number {
  return Math.round(eur * 100) / 100;
}

// ─── Offer inclusions ─────────────────────────────────────────────────────────
// What the customer is getting. Baseline = always-included services every
// Kottke / Ceylan move ships with. Conditional items are flipped between
// "included" and "optional" based on the linked auftrag's checkbox + number
// flags. If no auftrag exists yet the customer still sees the baseline.

const BASELINE_INCLUSIONS: { key: string; label: string }[] = [
  { key: "insurance", label: "Transportversicherung bis 5.000 EUR" },
  { key: "blankets", label: "Decken und Polstermaterial" },
  { key: "tools", label: "Werkzeug (Sackkarre, Gurte, Möbelhund)" },
  { key: "load_unload", label: "An- und Abladen" },
];

interface ConditionalDef {
  /** Slug of the boolean/number attribute on the auftrag record. */
  slug: string;
  /** What it's called on the offer. */
  label: string;
  /** Stable key for analytics. */
  key: string;
  /** Optional formatter for numeric attributes ("Anzahl 30" etc.). */
  detailFromNumber?: (n: number) => string;
}

const CONDITIONALS: ConditionalDef[] = [
  { slug: "dismantling_required", label: "Demontage und Montage", key: "dismantling" },
  { slug: "packing_service", label: "Einpackservice", key: "packing" },
  { slug: "piano_transport", label: "Klaviertransport", key: "piano" },
  { slug: "disposal_required", label: "Sperrmüll und Entsorgung", key: "disposal" },
  { slug: "storage_required", label: "Einlagerung", key: "storage" },
  { slug: "parking_halteverbot_needed", label: "Halteverbotszone einrichten", key: "halteverbot" },
  {
    slug: "boxes_needed",
    label: "Umzugskartons",
    key: "boxes",
    detailFromNumber: (n) => (n > 0 ? `Anzahl ${n}` : ""),
  },
];

async function loadInclusions(
  workspaceId: string,
  dealRecordId: string
): Promise<OfferInclusions> {
  // Find the auftrag (if any) attached to this deal.
  const [auftragObj] = await db
    .select({ id: objects.id })
    .from(objects)
    .where(and(eq(objects.workspaceId, workspaceId), eq(objects.slug, "auftraege")))
    .limit(1);

  const included: OfferInclusions["included"] = BASELINE_INCLUSIONS.map((b) => ({
    key: b.key,
    label: b.label,
    detail: null,
  }));
  const optional: OfferInclusions["optional"] = [];

  if (!auftragObj) {
    // No auftrag-object provisioned in this workspace: ship only the baseline,
    // mark every conditional as optional.
    for (const c of CONDITIONALS) {
      optional.push({ key: c.key, label: c.label, detail: null });
    }
    return { included, optional };
  }

  // Resolve auftrag attributes by slug.
  const attrRows = await db
    .select({ id: attributes.id, slug: attributes.slug, type: attributes.type })
    .from(attributes)
    .where(eq(attributes.objectId, auftragObj.id));
  const attrBySlug = new Map(attrRows.map((a) => [a.slug, a]));

  // Find the auftrag record linked to the deal via the `deal` ref attribute.
  const dealRefAttr = attrBySlug.get("deal");
  let auftragRecordId: string | null = null;
  if (dealRefAttr) {
    const [link] = await db
      .select({ recordId: recordValues.recordId })
      .from(recordValues)
      .innerJoin(records, eq(records.id, recordValues.recordId))
      .where(
        and(
          eq(records.objectId, auftragObj.id),
          eq(recordValues.attributeId, dealRefAttr.id),
          eq(recordValues.referencedRecordId, dealRecordId)
        )
      )
      .limit(1);
    auftragRecordId = link?.recordId ?? null;
  }

  // No linked auftrag yet: same fallback as above.
  if (!auftragRecordId) {
    for (const c of CONDITIONALS) {
      optional.push({ key: c.key, label: c.label, detail: null });
    }
    return { included, optional };
  }

  // Bulk-load values for the conditional attributes on the auftrag.
  const wantedAttrIds = CONDITIONALS.map((c) => attrBySlug.get(c.slug)?.id).filter(
    (id): id is string => !!id
  );
  const vals = wantedAttrIds.length
    ? await db
        .select({
          attributeId: recordValues.attributeId,
          booleanValue: recordValues.booleanValue,
          numberValue: recordValues.numberValue,
        })
        .from(recordValues)
        .where(
          and(
            eq(recordValues.recordId, auftragRecordId),
            inArray(recordValues.attributeId, wantedAttrIds)
          )
        )
    : [];
  const valByAttr = new Map(vals.map((v) => [v.attributeId, v]));

  for (const c of CONDITIONALS) {
    const attr = attrBySlug.get(c.slug);
    if (!attr) {
      optional.push({ key: c.key, label: c.label, detail: null });
      continue;
    }
    const v = valByAttr.get(attr.id);
    if (c.detailFromNumber) {
      const n = v?.numberValue != null ? Number(v.numberValue) : 0;
      if (n > 0) {
        included.push({ key: c.key, label: c.label, detail: c.detailFromNumber(n) });
      } else {
        optional.push({ key: c.key, label: c.label, detail: null });
      }
    } else {
      if (v?.booleanValue === true) {
        included.push({ key: c.key, label: c.label, detail: null });
      } else {
        optional.push({ key: c.key, label: c.label, detail: null });
      }
    }
  }

  return { included, optional };
}
