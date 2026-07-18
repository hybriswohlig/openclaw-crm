/**
 * Operator-facing service for per-operating-company portal settings.
 *
 * Kept separate from `customer-portal-data.ts` (the customer-side data
 * adapter) so the separation boundary stays clean:
 *
 *   • customer-portal-data.ts  → read-only-for-customers helpers; the public
 *                                API talks only to this file.
 *   • customer-portal-config.ts → admin-only settings + DNS/Vercel verify;
 *                                the /settings UI + /api/v1 operator routes
 *                                talk to this file.
 *
 * When the portal moves to its own repo, this whole file stays in the CRM.
 */

import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { operatingCompanyPortalSettings, offerPackages } from "@/db/schema/customer-portal";
import { objects, attributes } from "@/db/schema/objects";
import { records, recordValues } from "@/db/schema/records";
import {
  brandingForOperatingCompany,
  type FirmaBranding,
} from "@openclaw-crm/customer-portal-core";
import { checkDomain, type DnsCheckResult } from "./dns-verify";
import {
  attachDomain as vercelAttachDomain,
  getDomainStatus as vercelGetDomainStatus,
  triggerVerify as vercelTriggerVerify,
  isConfigured as vercelIsConfigured,
  type VercelDomainStatus,
} from "./vercel-domains";

// ─── Types ─────────────────────────────────────────────────────────────────────

export type DomainVerificationState =
  | "unconfigured"
  | "pending_dns"
  | "pending_ssl"
  | "verified"
  | "error";

export interface OperatingCompanyPortalSettings {
  operatingCompanyRecordId: string;
  /** Live name from the records table (for the settings list). */
  operatingCompanyName: string;
  enabled: boolean;
  customDomain: string | null;
  publicUrlPreview: string | null;

  domainVerificationState: DomainVerificationState;
  domainAddedToVercelAt: string | null;
  domainVerifiedAt: string | null;
  domainLastCheckedAt: string | null;
  domainLastCheckError: string | null;
  vercelVerification: Array<{ type: string; domain: string; value: string; reason?: string }> | null;
  vercelIntegrationAvailable: boolean;

  // Branding (any null = use stamm fallback)
  displayName: string | null;
  primaryColor: string | null;
  logoUrl: string | null;
  footerText: string | null;
  googleReviewUrl: string | null;
  whatsappNumberE164: string | null;
  bankIban: string | null;
  bankBic: string | null;
  bankHolder: string | null;
  paypalHandle: string | null;
  agbVersion: string | null;
  agbPdfUrl: string | null;
}

export interface PortalSettingsUpdate {
  enabled?: boolean;
  customDomain?: string | null;
  displayName?: string | null;
  primaryColor?: string | null;
  logoUrl?: string | null;
  footerText?: string | null;
  googleReviewUrl?: string | null;
  whatsappNumberE164?: string | null;
  bankIban?: string | null;
  bankBic?: string | null;
  bankHolder?: string | null;
  paypalHandle?: string | null;
  agbVersion?: string | null;
  agbPdfUrl?: string | null;
}

// ─── List + load ──────────────────────────────────────────────────────────────

/**
 * Returns one row per operating-company record in the workspace, joined with
 * the (possibly absent) portal-settings row. Missing settings rows are
 * surfaced with sensible defaults so the UI can render a "not configured yet"
 * state.
 */
export async function listOperatingCompanyPortalSettings(
  workspaceId: string
): Promise<OperatingCompanyPortalSettings[]> {
  const ocs = await loadOperatingCompanyRecords(workspaceId);
  if (ocs.length === 0) return [];

  const settingsRows = await db
    .select()
    .from(operatingCompanyPortalSettings)
    .where(eq(operatingCompanyPortalSettings.workspaceId, workspaceId));
  const byOc = new Map(settingsRows.map((s) => [s.operatingCompanyRecordId, s]));
  const vercelAvailable = vercelIsConfigured();

  return ocs.map((oc) => {
    const s = byOc.get(oc.id);
    return shapeSettings(oc.id, oc.name, s, vercelAvailable);
  });
}

export async function getOperatingCompanyPortalSettings(
  workspaceId: string,
  operatingCompanyRecordId: string
): Promise<OperatingCompanyPortalSettings | null> {
  const [oc] = await db
    .select({ id: records.id })
    .from(records)
    .where(eq(records.id, operatingCompanyRecordId))
    .limit(1);
  if (!oc) return null;

  const ocName = await loadOperatingCompanyName(operatingCompanyRecordId);

  const [row] = await db
    .select()
    .from(operatingCompanyPortalSettings)
    .where(
      and(
        eq(operatingCompanyPortalSettings.workspaceId, workspaceId),
        eq(
          operatingCompanyPortalSettings.operatingCompanyRecordId,
          operatingCompanyRecordId
        )
      )
    )
    .limit(1);

  return shapeSettings(operatingCompanyRecordId, ocName, row, vercelIsConfigured());
}

// ─── Mutate ───────────────────────────────────────────────────────────────────

/**
 * Idempotent upsert. Returns the freshly-loaded settings.
 */
export async function upsertOperatingCompanyPortalSettings(
  workspaceId: string,
  operatingCompanyRecordId: string,
  patch: PortalSettingsUpdate
): Promise<OperatingCompanyPortalSettings | null> {
  // If customDomain is being changed, reset verification state.
  const [existing] = await db
    .select()
    .from(operatingCompanyPortalSettings)
    .where(
      and(
        eq(operatingCompanyPortalSettings.workspaceId, workspaceId),
        eq(
          operatingCompanyPortalSettings.operatingCompanyRecordId,
          operatingCompanyRecordId
        )
      )
    )
    .limit(1);

  const cleaned = cleanPatch(patch);
  const domainChanged =
    "customDomain" in cleaned &&
    (existing?.customDomain ?? null) !== (cleaned.customDomain ?? null);

  if (!existing) {
    await db.insert(operatingCompanyPortalSettings).values({
      workspaceId,
      operatingCompanyRecordId,
      ...cleaned,
    });
  } else {
    await db
      .update(operatingCompanyPortalSettings)
      .set({
        ...cleaned,
        ...(domainChanged
          ? {
              domainVerificationState: cleaned.customDomain ? "pending_dns" : "unconfigured",
              domainAddedToVercelAt: null,
              domainVerifiedAt: null,
              domainLastCheckedAt: null,
              domainLastCheckError: null,
              vercelVerification: null,
            }
          : {}),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(operatingCompanyPortalSettings.workspaceId, workspaceId),
          eq(
            operatingCompanyPortalSettings.operatingCompanyRecordId,
            operatingCompanyRecordId
          )
        )
      );
  }

  return getOperatingCompanyPortalSettings(workspaceId, operatingCompanyRecordId);
}

// ─── Domain verification ──────────────────────────────────────────────────────

export interface DomainVerificationReport {
  state: DomainVerificationState;
  domain: string;
  dns: DnsCheckResult;
  vercel: VercelDomainStatus | null;
  vercelAvailable: boolean;
}

/**
 * Runs DNS + (optional) Vercel verification end-to-end and persists the
 * resulting state on the settings row. Safe to call repeatedly — operator
 * presses a "Verify" button in the UI.
 */
export async function verifyOperatingCompanyDomain(
  workspaceId: string,
  operatingCompanyRecordId: string
): Promise<DomainVerificationReport | null> {
  const settings = await getOperatingCompanyPortalSettings(
    workspaceId,
    operatingCompanyRecordId
  );
  if (!settings) return null;
  const domain = settings.customDomain;
  if (!domain) {
    await persistVerificationFailure(workspaceId, operatingCompanyRecordId, "Keine Domain konfiguriert.");
    return null;
  }

  const dnsResult = await checkDomain(domain);
  const vercelAvailable = vercelIsConfigured();
  let vercelStatus: VercelDomainStatus | null = null;

  if (vercelAvailable) {
    vercelStatus = await vercelGetDomainStatus(domain);
    if (!vercelStatus.attached) {
      // Not yet attached → try to attach now.
      vercelStatus = await vercelAttachDomain(domain);
    } else if (!vercelStatus.verified) {
      // Already attached but not verified → poke Vercel to re-check.
      vercelStatus = await vercelTriggerVerify(domain);
    }
  }

  const state = computeState(dnsResult, vercelStatus, vercelAvailable);
  const errorMessage = dnsResult.errorMessage ?? vercelStatus?.error ?? null;

  await db
    .update(operatingCompanyPortalSettings)
    .set({
      domainVerificationState: state,
      domainLastCheckedAt: new Date(),
      domainLastCheckError: errorMessage,
      domainAddedToVercelAt:
        vercelStatus?.attached && !settings.domainAddedToVercelAt ? new Date() : undefined,
      domainVerifiedAt: state === "verified" ? new Date() : undefined,
      vercelVerification: vercelStatus?.verification ?? null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(operatingCompanyPortalSettings.workspaceId, workspaceId),
        eq(
          operatingCompanyPortalSettings.operatingCompanyRecordId,
          operatingCompanyRecordId
        )
      )
    );

  return { state, domain, dns: dnsResult, vercel: vercelStatus, vercelAvailable };
}

// ─── Branding lookup (consumed by customer-portal-data.ts) ────────────────────

/**
 * Returns the effective branding for an operating company: DB row first,
 * stamm.ts constants as fallback for any field still null. Also returns the
 * enabled flag so the caller can short-circuit when the feature is off.
 */
export interface EffectiveBranding {
  enabled: boolean;
  customDomain: string | null;
  /** True only when DNS + Vercel verification completed for customDomain. */
  domainVerified: boolean;
  branding: FirmaBranding;
}

export async function loadEffectiveBranding(
  operatingCompanyRecordId: string | null
): Promise<EffectiveBranding> {
  const name = operatingCompanyRecordId
    ? await loadOperatingCompanyName(operatingCompanyRecordId)
    : null;
  const fallback = brandingForOperatingCompany(name);

  if (!operatingCompanyRecordId) {
    return { enabled: true, customDomain: null, domainVerified: false, branding: fallback };
  }

  const [s] = await db
    .select()
    .from(operatingCompanyPortalSettings)
    .where(
      eq(operatingCompanyPortalSettings.operatingCompanyRecordId, operatingCompanyRecordId)
    )
    .limit(1);

  if (!s) return { enabled: true, customDomain: null, domainVerified: false, branding: fallback };

  const branding: FirmaBranding = {
    firmaSlug: fallback.firmaSlug,
    displayName: s.displayName ?? fallback.displayName,
    primaryColor: s.primaryColor ?? fallback.primaryColor,
    logoUrl: s.logoUrl ?? fallback.logoUrl,
    footer: s.footerText ?? fallback.footer,
    googleReviewUrl: s.googleReviewUrl ?? fallback.googleReviewUrl,
    whatsappNumberE164: s.whatsappNumberE164 ?? fallback.whatsappNumberE164,
    bank: {
      iban: s.bankIban ?? fallback.bank.iban,
      bic: s.bankBic ?? fallback.bank.bic,
      holder: s.bankHolder ?? fallback.bank.holder,
    },
    paypal: {
      handleOrEmail: s.paypalHandle ?? fallback.paypal.handleOrEmail,
    },
    agbVersion: s.agbVersion ?? fallback.agbVersion,
    agbPdfUrl: s.agbPdfUrl ?? fallback.agbPdfUrl,
  };

  return {
    enabled: s.enabled,
    customDomain: s.customDomain,
    domainVerified: s.domainVerificationState === "verified",
    branding,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function loadOperatingCompanyRecords(workspaceId: string): Promise<
  { id: string; name: string }[]
> {
  const [obj] = await db
    .select({ id: objects.id })
    .from(objects)
    .where(and(eq(objects.workspaceId, workspaceId), eq(objects.slug, "operating_companies")))
    .limit(1);
  if (!obj) return [];

  const [nameAttr] = await db
    .select({ id: attributes.id })
    .from(attributes)
    .where(and(eq(attributes.objectId, obj.id), eq(attributes.slug, "name")))
    .limit(1);

  const recs = await db
    .select({ id: records.id })
    .from(records)
    .where(eq(records.objectId, obj.id));
  if (recs.length === 0 || !nameAttr) return [];

  const vals = await db
    .select({ recordId: recordValues.recordId, textValue: recordValues.textValue })
    .from(recordValues)
    .where(eq(recordValues.attributeId, nameAttr.id));
  const byRec = new Map(vals.map((v) => [v.recordId, v.textValue ?? ""]));

  return recs
    .map((r) => ({ id: r.id, name: byRec.get(r.id) ?? "Unbenannt" }))
    .sort((a, b) => a.name.localeCompare(b.name, "de"));
}

async function loadOperatingCompanyName(recordId: string): Promise<string | null> {
  const [r] = await db
    .select({ objectId: records.objectId })
    .from(records)
    .where(eq(records.id, recordId))
    .limit(1);
  if (!r) return null;
  const [nameAttr] = await db
    .select({ id: attributes.id })
    .from(attributes)
    .where(and(eq(attributes.objectId, r.objectId), eq(attributes.slug, "name")))
    .limit(1);
  if (!nameAttr) return null;
  const [v] = await db
    .select({ textValue: recordValues.textValue })
    .from(recordValues)
    .where(
      and(eq(recordValues.recordId, recordId), eq(recordValues.attributeId, nameAttr.id))
    )
    .limit(1);
  return v?.textValue ?? null;
}

function cleanPatch(patch: PortalSettingsUpdate): PortalSettingsUpdate {
  const out: PortalSettingsUpdate = {};
  const fields: Array<keyof PortalSettingsUpdate> = [
    "enabled",
    "customDomain",
    "displayName",
    "primaryColor",
    "logoUrl",
    "footerText",
    "googleReviewUrl",
    "whatsappNumberE164",
    "bankIban",
    "bankBic",
    "bankHolder",
    "paypalHandle",
    "agbVersion",
    "agbPdfUrl",
  ];
  for (const k of fields) {
    if (k in patch) {
      const v = patch[k];
      if (k === "customDomain" && typeof v === "string") {
        // Normalise: lowercase, strip scheme + trailing slash.
        const cleaned = v
          .trim()
          .toLowerCase()
          .replace(/^https?:\/\//, "")
          .replace(/\/.*$/, "");
        (out[k] as string | null) = cleaned || null;
      } else if (k === "primaryColor" && typeof v === "string") {
        (out[k] as string | null) = v.replace(/^#/, "").toLowerCase() || null;
      } else {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (out as any)[k] = v;
      }
    }
  }
  return out;
}

function computeState(
  dns: DnsCheckResult,
  vercel: VercelDomainStatus | null,
  vercelAvailable: boolean
): DomainVerificationState {
  if (!dns.dnsOk) return "pending_dns";
  if (vercelAvailable) {
    if (!vercel) return "error";
    if (!vercel.attached) return "pending_ssl";
    if (!vercel.verified) return "pending_ssl";
  }
  if (!dns.httpsReachable) return "pending_ssl";
  return "verified";
}

async function persistVerificationFailure(
  workspaceId: string,
  operatingCompanyRecordId: string,
  message: string
): Promise<void> {
  await db
    .update(operatingCompanyPortalSettings)
    .set({
      domainVerificationState: "error",
      domainLastCheckedAt: new Date(),
      domainLastCheckError: message,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(operatingCompanyPortalSettings.workspaceId, workspaceId),
        eq(
          operatingCompanyPortalSettings.operatingCompanyRecordId,
          operatingCompanyRecordId
        )
      )
    );
}

function shapeSettings(
  ocId: string,
  ocName: string | null,
  s: typeof operatingCompanyPortalSettings.$inferSelect | undefined,
  vercelAvailable: boolean
): OperatingCompanyPortalSettings {
  const customDomain = s?.customDomain ?? null;
  const publicUrlPreview = customDomain
    ? `https://${customDomain}/s/<TOKEN>`
    : null;
  return {
    operatingCompanyRecordId: ocId,
    operatingCompanyName: ocName ?? "Unbenannt",
    enabled: s?.enabled ?? true,
    customDomain,
    publicUrlPreview,
    domainVerificationState: (s?.domainVerificationState ?? "unconfigured") as DomainVerificationState,
    domainAddedToVercelAt: s?.domainAddedToVercelAt?.toISOString() ?? null,
    domainVerifiedAt: s?.domainVerifiedAt?.toISOString() ?? null,
    domainLastCheckedAt: s?.domainLastCheckedAt?.toISOString() ?? null,
    domainLastCheckError: s?.domainLastCheckError ?? null,
    vercelVerification:
      (s?.vercelVerification as OperatingCompanyPortalSettings["vercelVerification"]) ?? null,
    vercelIntegrationAvailable: vercelAvailable,
    displayName: s?.displayName ?? null,
    primaryColor: s?.primaryColor ?? null,
    logoUrl: s?.logoUrl ?? null,
    footerText: s?.footerText ?? null,
    googleReviewUrl: s?.googleReviewUrl ?? null,
    whatsappNumberE164: s?.whatsappNumberE164 ?? null,
    bankIban: s?.bankIban ?? null,
    bankBic: s?.bankBic ?? null,
    bankHolder: s?.bankHolder ?? null,
    paypalHandle: s?.paypalHandle ?? null,
    agbVersion: s?.agbVersion ?? null,
    agbPdfUrl: s?.agbPdfUrl ?? null,
  };
}

// ─── Offer packages CRUD ──────────────────────────────────────────────────────

export interface OfferPackageRow {
  id: string;
  slug: string;
  displayName: string;
  shortDescription: string | null;
  targetSegment: string | null;
  priceFromCents: number | null;
  priceFixedFlag: boolean;
  includedItems: string[];
  isRecommended: boolean;
  sortOrder: number;
  active: boolean;
}

export interface OfferPackageInput {
  slug: string;
  displayName: string;
  shortDescription?: string | null;
  targetSegment?: string | null;
  priceFromCents?: number | null;
  priceFixedFlag?: boolean;
  includedItems?: string[];
  isRecommended?: boolean;
  sortOrder?: number;
  active?: boolean;
}

export async function listOfferPackages(
  workspaceId: string,
  operatingCompanyRecordId: string
): Promise<OfferPackageRow[]> {
  const rows = await db
    .select()
    .from(offerPackages)
    .where(
      and(
        eq(offerPackages.workspaceId, workspaceId),
        eq(offerPackages.operatingCompanyRecordId, operatingCompanyRecordId)
      )
    )
    .orderBy(offerPackages.sortOrder);
  return rows.map(shapeOfferPackage);
}

export async function createOfferPackage(
  workspaceId: string,
  operatingCompanyRecordId: string,
  input: OfferPackageInput
): Promise<OfferPackageRow | null> {
  if (!input.slug || !input.displayName) return null;
  const slug = normalizeSlug(input.slug);
  const [row] = await db
    .insert(offerPackages)
    .values({
      workspaceId,
      operatingCompanyRecordId,
      slug,
      displayName: input.displayName.trim(),
      shortDescription: input.shortDescription?.trim() || null,
      targetSegment: input.targetSegment?.trim() || null,
      priceFromCents: input.priceFromCents ?? null,
      priceFixedFlag: input.priceFixedFlag ?? false,
      includedItems: input.includedItems ?? [],
      isRecommended: input.isRecommended ?? false,
      sortOrder: input.sortOrder ?? 100,
      active: input.active ?? true,
    })
    .returning();
  return row ? shapeOfferPackage(row) : null;
}

export async function updateOfferPackage(
  workspaceId: string,
  operatingCompanyRecordId: string,
  packageId: string,
  patch: Partial<OfferPackageInput>
): Promise<OfferPackageRow | null> {
  const cleaned: Record<string, unknown> = { updatedAt: new Date() };
  if (patch.slug !== undefined) cleaned.slug = normalizeSlug(patch.slug);
  if (patch.displayName !== undefined) cleaned.displayName = patch.displayName.trim();
  if (patch.shortDescription !== undefined)
    cleaned.shortDescription = patch.shortDescription?.trim() || null;
  if (patch.targetSegment !== undefined)
    cleaned.targetSegment = patch.targetSegment?.trim() || null;
  if (patch.priceFromCents !== undefined) cleaned.priceFromCents = patch.priceFromCents;
  if (patch.priceFixedFlag !== undefined) cleaned.priceFixedFlag = patch.priceFixedFlag;
  if (patch.includedItems !== undefined) cleaned.includedItems = patch.includedItems;
  if (patch.isRecommended !== undefined) cleaned.isRecommended = patch.isRecommended;
  if (patch.sortOrder !== undefined) cleaned.sortOrder = patch.sortOrder;
  if (patch.active !== undefined) cleaned.active = patch.active;

  const [row] = await db
    .update(offerPackages)
    .set(cleaned)
    .where(
      and(
        eq(offerPackages.id, packageId),
        eq(offerPackages.workspaceId, workspaceId),
        eq(offerPackages.operatingCompanyRecordId, operatingCompanyRecordId)
      )
    )
    .returning();
  return row ? shapeOfferPackage(row) : null;
}

export async function deleteOfferPackage(
  workspaceId: string,
  operatingCompanyRecordId: string,
  packageId: string
): Promise<boolean> {
  const [row] = await db
    .delete(offerPackages)
    .where(
      and(
        eq(offerPackages.id, packageId),
        eq(offerPackages.workspaceId, workspaceId),
        eq(offerPackages.operatingCompanyRecordId, operatingCompanyRecordId)
      )
    )
    .returning({ id: offerPackages.id });
  return !!row;
}

function shapeOfferPackage(r: typeof offerPackages.$inferSelect): OfferPackageRow {
  return {
    id: r.id,
    slug: r.slug,
    displayName: r.displayName,
    shortDescription: r.shortDescription,
    targetSegment: r.targetSegment,
    priceFromCents: r.priceFromCents,
    priceFixedFlag: r.priceFixedFlag,
    includedItems: Array.isArray(r.includedItems) ? r.includedItems : [],
    isRecommended: r.isRecommended,
    sortOrder: r.sortOrder,
    active: r.active,
  };
}

function normalizeSlug(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    // strip combining diacritical marks via Unicode property escape
    .replace(/\p{M}/gu, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}
