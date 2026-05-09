import { createHash } from "node:crypto";

// Variant assignment + German message bodies for the post-move reviews
// engine. Pure helpers — no DB and no I/O. Used by the cron job (KOT-622)
// to produce the SMS body and the per-deal variant arm.
//
// Bodies are lifted from spec §5 (Variant A / Variant B) on KOT-596 with
// brand-name substitution per the "Ceylan Operations variants" note in
// the same section ("same structure, different brand voice — slightly
// less formal, signed 'Ceylan Umzüge'"). Sales Outreach is reviewing
// the tone in parallel on KOT-596; if line-level edits land before Meta
// template submission for Phase 2 ([KOT-618]), they apply here.

export type Brand = "kottke" | "ceylan";
export type Variant = "A" | "B";

export type ReviewDestinationKind = "google_kottke" | "google_ceylan" | "trustpilot_kottke";

export interface ReviewDestination {
  kind: ReviewDestinationKind;
  url: string;
}

interface BrandLabels {
  brandFull: string;   // "Kottke Umzüge" / "Ceylan Umzüge"
  teamName: string;    // "Kottke-Team" / "Ceylan-Team"
}

const BRAND_LABELS: Record<Brand, BrandLabels> = {
  kottke: { brandFull: "Kottke Umzüge", teamName: "Kottke-Team" },
  ceylan: { brandFull: "Ceylan Umzüge", teamName: "Ceylan-Team" },
};

// Deterministic 50/50 split per spec §4. SHA-1 of dealId, first 4 bytes
// as a uint32, modulo 2. SHA-1 is uniform enough for a binary split and
// avoids the modulo bias that hash(string) % 2 would have on a tiny
// JS-string-hash space.
export function assignVariant(dealId: string): Variant {
  const digest = createHash("sha1").update(dealId).digest();
  return digest.readUInt32BE(0) % 2 === 0 ? "A" : "B";
}

// Brand → review destination URL. Read from env so we can rotate the
// destination without a deploy (e.g. if Google flips the GBP review
// link format). The cron job catches the throw and marks the deal
// `failed` rather than sending a malformed link.
export function resolveDestination(brand: Brand): ReviewDestination {
  if (brand === "kottke") {
    const url = process.env.REVIEWS_GBP_URL_KOTTKE;
    if (!url) throw new Error("REVIEWS_GBP_URL_KOTTKE env var is not set");
    return { kind: "google_kottke", url };
  }
  const url = process.env.REVIEWS_GBP_URL_CEYLAN;
  if (!url) throw new Error("REVIEWS_GBP_URL_CEYLAN env var is not set");
  return { kind: "google_ceylan", url };
}

export interface VariantAArgs {
  brand: Brand;
  firstName: string;
  crewLeadFirstName: string;
  reviewLink: string;
}

export interface VariantBArgs {
  brand: Brand;
  firstName: string;
  crewLeadFirstName: string;
  crewPositiveNote: string | null;
  reviewLink: string;
}

export function renderVariantA(args: VariantAArgs): string {
  const labels = BRAND_LABELS[args.brand];
  return [
    `Hallo ${args.firstName},`,
    `hier ist ${args.crewLeadFirstName} von ${labels.brandFull} – wie war Ihr Umzug heute? Wenn alles geklappt hat, würden uns 30 Sekunden auf Google riesig helfen:`,
    args.reviewLink,
    `Falls etwas nicht gepasst hat, antworten Sie einfach kurz hier – wir kümmern uns persönlich.`,
    `Danke und gute Zeit im neuen Zuhause!`,
  ].join("\n");
}

// Variant B falls back to Variant A's body if the crew didn't tag a
// positive note at completion. Per spec §5: "Requires the crew lead to
// tag one positive moment in the CRM at completion … Falls back to
// Variant A wording if `crew_positive_note IS NULL`."
export function renderVariantB(args: VariantBArgs): string {
  const trimmed = (args.crewPositiveNote ?? "").trim();
  if (trimmed.length === 0) {
    return renderVariantA({
      brand: args.brand,
      firstName: args.firstName,
      crewLeadFirstName: args.crewLeadFirstName,
      reviewLink: args.reviewLink,
    });
  }
  const labels = BRAND_LABELS[args.brand];
  return [
    `Hallo ${args.firstName},`,
    `${args.crewLeadFirstName} hier vom ${labels.teamName}. Heute war ein guter Tag – ${trimmed}. Schön, dass wir dabei helfen durften.`,
    `Wenn Sie zwei Minuten haben: Eine kurze Google-Bewertung hilft uns mehr als jede Werbung – und Familien wie Ihrer, uns zu finden:`,
    args.reviewLink,
    `Falls etwas im Nachhinein noch fehlt, einfach hier antworten. Wir gehen jeder Nachricht nach.`,
    `Herzlich, ${args.crewLeadFirstName} & das ${labels.teamName}`,
  ].join("\n");
}
