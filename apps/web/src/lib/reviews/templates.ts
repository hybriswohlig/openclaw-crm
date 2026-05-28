import { createHash } from "node:crypto";

// Variant assignment + German message bodies for the post-move reviews
// engine. Pure helpers, no DB and no I/O. Used by the cron job (KOT-622)
// to produce the SMS body and the per-deal variant arm, and by the
// inbound complaint scanner (KOT-623) to render Template C.
//
// Phase 1 wording approved by CEO in KOT-603 comment bfabc24b:
// - No personal crew-lead name (deferred to Phase 1.5 once a
//   crew-lead-at-signoff field exists).
// - Brand-aware "Ihr {teamName}" sign-off so Ceylan deals never
//   read "Kottke-Team".
// - STOP opt-out line is non-negotiable per §7 UWG / DSGVO. KOT-623
//   wires the STOP keyword handler that flips do_not_contact_review.
// - Hyphens only, no en-dashes or smart quotes. Umlauts (ä/ö/ü/ß) are
//   in the basic GSM-7 character set so they stay; the en-dash is not,
//   which would force MessageBird to bill UCS-2 (70-char) segments
//   instead of 160-char GSM-7 ones.

export type Brand = "kottke" | "ceylan";
export type Variant = "A" | "B";

export type ReviewDestinationKind = "google_kottke" | "google_ceylan" | "trustpilot_kottke";

export interface ReviewDestination {
  kind: ReviewDestinationKind;
  url: string;
}

interface BrandLabels {
  brandFull: string;
  teamName: string;
}

const BRAND_LABELS: Record<Brand, BrandLabels> = {
  kottke: { brandFull: "Kottke Umzüge", teamName: "Kottke-Team" },
  ceylan: { brandFull: "Ceylan Umzüge", teamName: "Ceylan-Team" },
};

const STOP_LINE = "Antworten Sie STOP, um keine weiteren Nachrichten zu erhalten.";

// Deterministic 50/50 split per spec §4. SHA-1 of dealId, first 4 bytes
// as a uint32, modulo 2. SHA-1 is uniform enough for a binary split and
// avoids the modulo bias that hash(string) % 2 would have on a tiny
// JS-string-hash space.
export function assignVariant(dealId: string): Variant {
  const digest = createHash("sha1").update(dealId).digest();
  return digest.readUInt32BE(0) % 2 === 0 ? "A" : "B";
}

// Brand → review destination URL. `urlOverride` is the per-OC
// `customer_portal_settings.google_review_url` looked up by the cron — the
// admin-editable source of truth (Settings → Operating Companies). Falls
// back to env vars for back-compat with older deploys and to keep this
// helper pure (no DB) so it stays unit-testable. The cron job catches the
// throw and marks the deal `failed` rather than sending a malformed link.
export function resolveDestination(
  brand: Brand,
  urlOverride?: string | null,
): ReviewDestination {
  const kind: ReviewDestinationKind =
    brand === "kottke" ? "google_kottke" : "google_ceylan";
  const trimmed = urlOverride?.trim();
  if (trimmed) return { kind, url: trimmed };
  const envKey = brand === "kottke" ? "REVIEWS_GBP_URL_KOTTKE" : "REVIEWS_GBP_URL_CEYLAN";
  const url = process.env[envKey];
  if (!url) {
    throw new Error(
      `No review URL configured for brand '${brand}'. Set it in Settings → Operating Companies, or the ${envKey} env var.`,
    );
  }
  return { kind, url };
}

export interface VariantAArgs {
  brand: Brand;
  firstName: string;
  reviewLink: string;
}

export interface VariantBArgs {
  brand: Brand;
  firstName: string;
  crewPositiveNote: string | null;
  reviewLink: string;
}

export interface TemplateCArgs {
  brand: Brand;
  firstName: string;
}

export function renderVariantA(args: VariantAArgs): string {
  const labels = BRAND_LABELS[args.brand];
  return [
    `Hallo ${args.firstName},`,
    `hier ist Ihr ${labels.teamName} - wie war Ihr Umzug heute? Wenn alles geklappt hat, würden uns 30 Sekunden auf Google riesig helfen:`,
    args.reviewLink,
    `Falls etwas nicht gepasst hat, antworten Sie einfach kurz hier - wir kümmern uns persönlich.`,
    `Danke und gute Zeit im neuen Zuhause!`,
    STOP_LINE,
  ].join("\n");
}

// Variant B falls back to Variant A's body if the crew didn't tag a
// positive note at completion. Per spec §5: "Requires the crew lead to
// tag one positive moment in the CRM at completion ... Falls back to
// Variant A wording if `crew_positive_note IS NULL`."
export function renderVariantB(args: VariantBArgs): string {
  const trimmed = (args.crewPositiveNote ?? "").trim();
  if (trimmed.length === 0) {
    return renderVariantA({
      brand: args.brand,
      firstName: args.firstName,
      reviewLink: args.reviewLink,
    });
  }
  const labels = BRAND_LABELS[args.brand];
  return [
    `Hallo ${args.firstName},`,
    `Schöne Grüße vom ${labels.teamName}. Heute war ein guter Tag - ${trimmed}. Schön, dass wir dabei helfen durften.`,
    `Wenn Sie zwei Minuten haben: Eine kurze Google-Bewertung hilft uns mehr als jede Werbung - und Familien wie Ihrer, uns zu finden:`,
    args.reviewLink,
    `Falls etwas im Nachhinein noch fehlt, einfach hier antworten. Wir gehen jeder Nachricht nach.`,
    `Herzlich, Ihr ${labels.teamName}`,
    STOP_LINE,
  ].join("\n");
}

// Template C: auto-response when the inbound complaint scanner
// (KOT-623) classifies a customer reply as a complaint. CEO-approved
// wording from KOT-603 comment bfabc24b. Lives in this library so
// KOT-623 can import without another review cycle on the string.
export function renderTemplateC(args: TemplateCArgs): string {
  const labels = BRAND_LABELS[args.brand];
  return [
    `Hallo ${args.firstName},`,
    `das tut uns sehr leid - wir nehmen Ihre Rückmeldung ernst.`,
    `Darioush meldet sich persönlich bei Ihnen, sobald er Ihre Nachricht gelesen hat. Bis dahin keine weiteren Bewertungsanfragen von uns.`,
    `Ihr ${labels.teamName}`,
  ].join("\n");
}
