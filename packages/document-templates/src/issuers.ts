import type { FirmaSlug, IssuerView } from "./types";

/**
 * Letterhead printed by this template. Versioned with TEMPLATE_VERSION.
 * Kleinunternehmer (§ 19 UStG): no VAT line, ever.
 */
const ISSUERS: Record<FirmaSlug, IssuerView> = {
  kottke: {
    slug: "kottke",
    displayName: "Kottke Dienstleistungen",
    lines: [
      "Inhaber: Darioush Kottke",
      "Marktstr. 8",
      "72218 Wildberg",
      "Tel.: +49 175 9498475",
    ],
    bank: {
      iban: "DE81 1001 8000 0379 5948 02",
      bic: "FNOMDEB2",
      holder: "Darioush Kottke",
    },
    accent: "#1f3a5f",
  },
  ceylan: {
    slug: "ceylan",
    displayName: "Ceylan Umzüge & Transporte",
    lines: [
      "Inh. Nurullah Ceylan",
      "Kapellenberg 13",
      "72218 Wildberg",
      "info@ceylan-operations.de",
    ],
    bank: {
      iban: "DE93 1001 8000 0601 9731 97",
      bic: "FNOMDEB2",
      holder: "Nurullah Ceylan",
    },
    accent: "#ea580c",
  },
};

export function issuerFor(firma: FirmaSlug): IssuerView {
  return ISSUERS[firma];
}
