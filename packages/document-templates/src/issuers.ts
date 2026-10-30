import type { FirmaSlug, IssuerView, Letterhead } from "./types";

/**
 * Printed Kottke letterhead. Einstellungen → Gesellschaften overrides any
 * field that is filled in. Empty fields keep these defaults. Ceylan is not
 * filled from this block.
 */
export const KOTTKE_LETTERHEAD: Required<Letterhead> = {
  legalName: "Kottke Entrümpelung & Umzüge",
  phone: "07054 9306962",
  whatsapp: "0151 59058963",
  email: "kontakt@kottke-umzuege.de",
  street: "Marktstr. 8",
  postalCode: "72218",
  city: "Wildberg",
  website: "https://kottke-umzuege.de",
  owner: "Inhaber: Darioush Kottke",
};

const CEYLAN_LINES = [
  "Inh. Nurullah Ceylan",
  "Kapellenberg 13",
  "72218 Wildberg",
  "info@ceylan-operations.de",
];

const ISSUERS: Record<FirmaSlug, IssuerView> = {
  kottke: {
    slug: "kottke",
    displayName: KOTTKE_LETTERHEAD.legalName,
    lines: letterheadLines(KOTTKE_LETTERHEAD),
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
    lines: CEYLAN_LINES,
    bank: {
      iban: "DE93 1001 8000 0601 9731 97",
      bic: "FNOMDEB2",
      holder: "Nurullah Ceylan",
    },
    accent: "#ea580c",
  },
};

function filled(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export function letterheadLines(input: Letterhead): string[] {
  const place = [filled(input.postalCode), filled(input.city)].filter(Boolean).join(" ");
  return [
    filled(input.owner),
    filled(input.street),
    place || undefined,
    filled(input.phone) ? `Tel.: ${filled(input.phone)}` : undefined,
    filled(input.whatsapp) ? `WhatsApp: ${filled(input.whatsapp)}` : undefined,
    filled(input.email),
    filled(input.website),
  ].filter((line): line is string => Boolean(line));
}

/** Text fields from an operating-company record. Blank fields stay unset. */
export function letterheadFromValues(
  values: Record<string, unknown> | null | undefined
): Letterhead {
  const text = (slug: string) => {
    const value = values?.[slug];
    return typeof value === "string" ? value : undefined;
  };
  return {
    legalName: text("legal_name"),
    phone: text("phone"),
    whatsapp: text("whatsapp"),
    email: text("email"),
    street: text("street"),
    postalCode: text("postal_code"),
    city: text("city"),
    website: text("website"),
  };
}

function mergeLetterhead(base: Required<Letterhead>, overlay?: Letterhead | null): Required<Letterhead> {
  const pick = (key: keyof Letterhead) => filled(overlay?.[key]) ?? base[key];
  return {
    legalName: pick("legalName"),
    phone: pick("phone"),
    whatsapp: pick("whatsapp"),
    email: pick("email"),
    street: pick("street"),
    postalCode: pick("postalCode"),
    city: pick("city"),
    website: pick("website"),
    owner: pick("owner"),
  };
}

/**
 * Letterhead for a document. Kottke starts from KOTTKE_LETTERHEAD and lets
 * per-company settings replace individual lines. Ceylan stays on its own
 * data unless that company's settings actually contain a value.
 */
export function issuerFor(firma: FirmaSlug, letterhead?: Letterhead | null): IssuerView {
  const base = ISSUERS[firma];
  if (firma !== "kottke") {
    if (!letterhead || !Object.values(letterhead).some((value) => filled(value))) return base;
    const lines = [...base.lines];
    const phone = filled(letterhead.phone);
    const email = filled(letterhead.email);
    const street = filled(letterhead.street);
    const place = [filled(letterhead.postalCode), filled(letterhead.city)].filter(Boolean).join(" ");
    if (street) lines[1] = street;
    if (place) lines[2] = place;
    if (email) lines[3] = email;
    if (phone) lines.push(`Tel.: ${phone}`);
    const whatsapp = filled(letterhead.whatsapp);
    if (whatsapp) lines.push(`WhatsApp: ${whatsapp}`);
    const website = filled(letterhead.website);
    if (website) lines.push(website);
    return {
      ...base,
      displayName: filled(letterhead.legalName) ?? base.displayName,
      lines,
    };
  }
  const merged = mergeLetterhead(KOTTKE_LETTERHEAD, letterhead);
  return {
    ...base,
    displayName: merged.legalName,
    lines: letterheadLines(merged),
  };
}
