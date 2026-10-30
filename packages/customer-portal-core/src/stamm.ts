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
  displayName: "Kottke Entrümpelung & Umzüge",
  primaryColor: "c2570c",
  logoUrl: "/branding/kottke/logo.svg",
  footer:
    "Kottke Entrümpelung & Umzüge · Inhaber: Darioush Kottke · Marktstr. 8 · 72218 Wildberg · Tel.: 07054 9306962 · WhatsApp: 0151 59058963 · kontakt@kottke-umzuege.de",
  googleReviewUrl: null,
  whatsappNumberE164: "4915159058963",
  bank: {
    iban: "DE81100180000379594802",
    bic: "FNOMDEB2",
    holder: "Darioush Kottke",
  },
  paypal: { handleOrEmail: null },
  agbVersion: "kottke-2026-10",
  agbPdfUrl: "/legal/agb/kottke",
  ansprechpartner: {
    name: "Dario Kottke",
    rolle: "Inhaber",
    fotoUrl: "/branding/kottke/dario-160.jpg",
    unterschriftUrl: "/branding/kottke/unterschrift-dario.png",
  },
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
  agbVersion: "ceylan-2026-10",
  agbPdfUrl: "/legal/agb/ceylan",
  ansprechpartner: null,
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
  ansprechpartner: null,
};

/**
 * Resolve branding from an operating-company display name. Case-insensitive
 * substring match — robust to spelling variations ("Kottke Umzüge",
 * "Kottke Entrümpelung & Umzüge", …).
 */
export function brandingForOperatingCompany(name: string | null): FirmaBranding {
  if (!name) return FALLBACK;
  const lower = name.toLowerCase();
  if (lower.includes("kottke")) return KOTTKE_BRANDING;
  if (lower.includes("ceylan")) return CEYLAN_BRANDING;
  return { ...FALLBACK, displayName: name };
}
