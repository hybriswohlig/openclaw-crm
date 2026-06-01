/**
 * Per-firma branding fallbacks. The long-term home for this data is the
 * `operating_companies` records in the CRM — see ARCHITECTURE.md. Until those
 * attributes are seeded via STANDARD_OBJECTS, the adapter falls back to these
 * constants by matching on operating-company `name`.
 *
 * Mirror of /home/ubuntu/apps/crm-tools/skills/rechnungen-und-auftragsbestaetigungen/stammdaten/{kottke,ceylan}.md
 */

import type { FirmaBranding } from "./types";

export const KOTTKE_BRANDING: FirmaBranding = {
  firmaSlug: "kottke",
  displayName: "Kottke Dienstleistungen",
  primaryColor: "1f3a5f",
  logoUrl: null,
  footer:
    "Kottke Dienstleistungen · Inhaber: Darioush Kottke · Marktstr. 8 · 72218 Wildberg · Tel.: +49 175 9498475",
  googleReviewUrl: null,
  whatsappNumberE164: "491759498475",
  bank: {
    iban: "DE81100180000379594802",
    bic: "FNOMDEB2",
    holder: "Darioush Kottke",
  },
  paypal: { handleOrEmail: null },
  agbVersion: "kottke-2026-06",
  agbPdfUrl: "/legal/agb/kottke",
};

export const CEYLAN_BRANDING: FirmaBranding = {
  firmaSlug: "ceylan",
  displayName: "Ceylan Umzüge & Transporte",
  primaryColor: "ea580c",
  logoUrl: null,
  footer:
    "Ceylan Umzüge & Transporte · Inh. Nurullah Ceylan · Kapellenberg 13, 72218 Wildberg · info@ceylan-operations.de",
  googleReviewUrl: null,
  whatsappNumberE164: null,
  bank: {
    iban: "DE93100180000601973197",
    bic: "FNOMDEB2",
    holder: "Nurullah Ceylan",
  },
  paypal: { handleOrEmail: null },
  agbVersion: "ceylan-2026-06",
  agbPdfUrl: "/legal/agb/ceylan",
};

const FALLBACK: FirmaBranding = {
  firmaSlug: "kottke",
  displayName: "Kottke Group",
  primaryColor: "1f3a5f",
  logoUrl: null,
  footer: null,
  googleReviewUrl: null,
  whatsappNumberE164: null,
  bank: { iban: null, bic: null, holder: null },
  paypal: { handleOrEmail: null },
  agbVersion: "default-2026-01",
  agbPdfUrl: null,
};

/**
 * Resolve branding from an operating-company display name. Case-insensitive
 * substring match — robust to spelling variations ("Kottke Umzüge",
 * "Kottke Dienstleistungen", …).
 */
export function brandingForOperatingCompany(name: string | null): FirmaBranding {
  if (!name) return FALLBACK;
  const lower = name.toLowerCase();
  if (lower.includes("kottke")) return KOTTKE_BRANDING;
  if (lower.includes("ceylan")) return CEYLAN_BRANDING;
  return { ...FALLBACK, displayName: name };
}
