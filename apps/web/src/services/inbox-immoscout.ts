/**
 * Pure helpers for ImmobilienScout24 (IS24) lead-email parsing.
 *
 * IS24 sends Umzug relocation requests as plain emails from
 * noreply@immobilienscout24.de (subject "IS24 Umzugsanfrage: ID <id> / <name>").
 * The full structured lead lives in the email body. This module turns that body
 * into the SAME moving_lead_payload shape the umzug-easy REST sync produces
 * (immoscout-sync.ts), so BOTH channels deduplicate on the shared IS24 request id
 * stored in payload.externalId.
 *
 * Dependency-free (no DB/IMAP/service imports) so it is unit-testable and safe to
 * call at ingest time (inbox-email.ts) and from the one-shot backfill.
 *
 * The IS24 request id and the umzug-easy `aid`/`ImportId` are the SAME id
 * (format "[8 digits][YYMMDDHHMMSS]"), which is what makes cross-channel dedup
 * trustworthy.
 */

const IS24_FROM_RE = /@immobilienscout24\.de$/i;
const IS24_LEAD_SUBJECT_RE = /^\s*IS24\s+Umzugsanfrage/i;

/** Any mail from the IS24 platform (lead OR AnfragenShop/notification noise). */
export function isImmoscoutEmail(from: string | null | undefined): boolean {
  return IS24_FROM_RE.test((from ?? "").trim().toLowerCase());
}

/** A real IS24 relocation request (vs. marketing/notification noise). */
export function isImmoscoutLeadEmail(
  from: string | null | undefined,
  subject: string | null | undefined
): boolean {
  return isImmoscoutEmail(from) && IS24_LEAD_SUBJECT_RE.test(subject ?? "");
}

export interface ImmoscoutParseResult {
  /** Full structured lead, same shape as immoscout-sync.ts payload. */
  payload: Record<string, unknown>;
  /** Human-readable summary string for the deal's inventory_notes. */
  inventoryNotes: string;
  /** The IS24 request id (= externalId for dedup). null if it could not be read. */
  externalId: string | null;
  /** Resolved customer identity, for resolveOrCreatePerson. */
  customer: {
    fullName: string;
    firstName: string;
    lastName: string;
    email: string | null;
    phone: string | null;
  };
  /** Pieces for computeLeadName (deal title). */
  dealNameParts: {
    customerName: string;
    fromCity: string;
    toCity: string;
    moveDate: string | null;
  };
}

// ─── Low-level value parsing ─────────────────────────────────────────────────

/** "Ja" / "Ja, kleiner Aufzug …" → true; everything else → false. */
function yesNo(v: string | undefined): boolean {
  return /^\s*ja\b/i.test(v ?? "");
}

/** "01.09.2026" → "2026-09-01"; unparseable → null. */
function deDateToYmd(v: string | undefined): string | null {
  const m = (v ?? "").match(/([0-9]{2})\.([0-9]{2})\.([0-9]{4})/);
  if (!m) return null;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

/** "04.06.2026" + "11:47" → "2026-06-04T11:47:00". */
function deDateTimeToIso(date: string, time?: string): string | null {
  const ymd = deDateToYmd(date);
  if (!ymd) return null;
  const t = (time ?? "").match(/([0-9]{1,2}):([0-9]{2})/);
  const hh = t ? t[1].padStart(2, "0") : "00";
  const mm = t ? t[2] : "00";
  return `${ymd}T${hh}:${mm}:00`;
}

/** "41,62 km" → 41.62; "50 m²" → 50; no number → null. */
function germanNumber(v: string | undefined): number | null {
  if (!v) return null;
  const cleaned = v
    .replace(/m&sup2;|m²|m2|km|m³|m&sup3;/gi, " ")
    .match(/-?[0-9][0-9.]*(?:,[0-9]+)?/);
  if (!cleaned) return null;
  const n = Number(cleaned[0].replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

/** "DE-71106 Magstadt" → { country:"DE", zip:"71106", city:"Magstadt" }. */
function splitPlzOrt(v: string | undefined): {
  country: string;
  zip: string;
  city: string;
} {
  const s = (v ?? "").trim();
  const m = s.match(/^([A-Za-z]{2})?[-\s]*([0-9]{4,5})\s+(.+)$/);
  if (m) return { country: (m[1] ?? "").toUpperCase(), zip: m[2], city: m[3].trim() };
  return { country: "", zip: "", city: s };
}

/** IS24 prints "keine Straße angegeben" when empty. */
function cleanStreet(v: string | undefined): string {
  const s = (v ?? "").trim();
  return /keine.*angegeben/i.test(s) ? "" : s;
}

/** "Gerrit Ermert" → { firstName:"Gerrit", lastName:"Ermert" }. */
function splitName(full: string): { firstName: string; lastName: string } {
  const parts = full.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: "", lastName: "" };
  if (parts.length === 1) return { firstName: parts[0], lastName: "" };
  return {
    firstName: parts.slice(0, -1).join(" "),
    lastName: parts[parts.length - 1],
  };
}

// ─── Body structure parsing ──────────────────────────────────────────────────

const SECTION_HEADERS = ["Kontaktdaten", "Auszug", "Einzug", "Details zur Anfrage"];

/** Split the body into the named sections (header line → following lines). */
function splitSections(body: string): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  let current: string | null = null;
  for (const raw of body.replace(/\r\n/g, "\n").split("\n")) {
    const line = raw.trim();
    const hit = SECTION_HEADERS.find((h) => line.toLowerCase() === h.toLowerCase());
    if (hit) {
      current = hit;
      out[hit] = [];
      continue;
    }
    if (current) out[current].push(raw);
  }
  return out;
}

/** Parse "  Label: Value" lines into a map (first occurrence wins). */
function fields(lines: string[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const idx = line.indexOf(":");
    if (idx <= 0) continue;
    const label = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (label && !m.has(label)) m.set(label, value);
  }
  return m;
}

/** Build the per-address sub-object of the payload. */
function parseAddress(f: Map<string, string>): {
  payload: Record<string, unknown>;
  city: string;
  street: string;
} {
  const { country, zip, city } = splitPlzOrt(f.get("PLZ / Ort"));
  const street = cleanStreet(f.get("Straße"));
  const elevatorInfo = (f.get("Aufzug im Haus") ?? "").trim();
  return {
    payload: {
      street,
      zip,
      city,
      country,
      building: (f.get("Gebäude") ?? "").trim(),
      floor: (f.get("Etage") ?? "").trim(),
      livingSpace: germanNumber(f.get("Fläche")),
      rooms: (f.get("Zimmer") ?? "").trim(),
      persons: (f.get("Anzahl Personen") ?? "").trim(),
      elevator: yesNo(elevatorInfo),
      elevatorInfo,
      basement: yesNo(f.get("Keller")),
      attic: yesNo(f.get("Dachboden")),
      balcony: yesNo(f.get("Balkon")),
      terrace: yesNo(f.get("Terrasse")),
      carryDistance: (f.get("Trageweg (Straße/Hauseingang)") ?? "").trim(),
      comment: "",
    },
    city,
    street,
  };
}

// ─── Main parser ─────────────────────────────────────────────────────────────

/** Map "Privat" / "Gewerblich" / "Behörde" → umzug-easy payment codes. */
function paymentCode(billing: string): string {
  const b = billing.toLowerCase();
  if (b.startsWith("privat")) return "bez_priv";
  if (b.startsWith("gewerb")) return "bez_ag";
  if (b.startsWith("beh")) return "bez_beh";
  return billing;
}

/**
 * Parse a full IS24 "Umzugsanfrage" email body into the moving_lead_payload
 * shape + a human-readable inventory_notes string. Returns null if the body is
 * clearly not an IS24 lead (no request id found).
 */
export function parseImmoscoutLeadEmail(
  body: string | null | undefined
): ImmoscoutParseResult | null {
  const text = (body ?? "").replace(/\r\n/g, "\n");
  if (!text.trim()) return null;

  // "Anfrage #95744021260604094746 vom 04.06.2026 um 11:47."
  const idMatch = text.match(
    /Anfrage\s*#\s*([0-9]{6,})\s*vom\s*([0-9]{2}\.[0-9]{2}\.[0-9]{4})(?:\s*um\s*([0-9]{1,2}:[0-9]{2}))?/i
  );
  const externalId = idMatch?.[1] ?? null;
  const createdAt = idMatch ? deDateTimeToIso(idMatch[2], idMatch[3]) : null;

  // Category headline between "=====" rules: PRIVATUMZUG / GEWERBEUMZUG / …
  const catMatch = text.match(/={5,}\s*\n\s*([A-Za-zÄÖÜäöü ]+?)\s*\n\s*={5,}/);
  const category = catMatch ? catMatch[1].trim() : "";
  const premiumLead = /Neue\s+Premium\s+Anfrage/i.test(text);

  const sections = splitSections(text);
  const kontakt = fields(sections["Kontaktdaten"] ?? []);
  const aus = fields(sections["Auszug"] ?? []);
  const ein = fields(sections["Einzug"] ?? []);
  const details = fields(sections["Details zur Anfrage"] ?? []);

  if (!externalId && kontakt.size === 0) return null;

  const fullName = (kontakt.get("Name") ?? "").trim();
  const { firstName, lastName } = splitName(fullName);
  const phone = (kontakt.get("Telefon") ?? "").trim() || null;
  const email =
    (kontakt.get("E-Mail") ?? kontakt.get("E-mail") ?? "").trim().toLowerCase() ||
    null;
  const billing = (kontakt.get("Abrechnung über") ?? "").trim();

  const from = parseAddress(aus);
  const to = parseAddress(ein);
  const desiredFrom = deDateToYmd(aus.get("ab") ?? ein.get("ab"));
  const distance = germanNumber(
    details.get("Entfernung vom Auszugsort zum Einzugsort")
  );

  const services = {
    packing: yesNo(aus.get("Einpacken")),
    unpacking: yesNo(ein.get("Auspacken")),
    furnitureDismantling: yesNo(aus.get("Möbel Abbau")),
    furnitureReassembly: yesNo(ein.get("Möbel Aufbau")),
    kitchenLoading: yesNo(aus.get("Küche Abbau")),
    kitchenUnloading: yesNo(ein.get("Küche Aufbau")),
    boxPacking: yesNo(aus.get("Umzugskartons benötigt")),
    packingMaterial: yesNo(aus.get("Verpackungsmaterial benötigt")),
    electricalWork: yesNo(aus.get("Elektroarbeiten")),
    storage: yesNo(ein.get("Möbel einlagern")),
    disposal: yesNo(aus.get("Entsorgung")),
    noParkingZone:
      yesNo(aus.get("Halteverbot beantragen")) ||
      yesNo(ein.get("Halteverbot beantragen")),
  };

  const payload: Record<string, unknown> = {
    externalId,
    importId: externalId,
    source: "immoscout24",
    channel: "email",
    leadType: "umzug",
    category,
    premiumLead,
    createdAt,
    client: {
      salutation: "",
      firstName,
      lastName,
      street: "",
      zip: "",
      city: "",
      phone: phone ?? "",
      phone2: "",
      email: email ?? "",
      comment: "",
    },
    from: from.payload,
    to: to.payload,
    dates: { desiredFrom, desiredTo: "", alternativeDate: false },
    services,
    ugl: {
      available: false,
      volume: null,
      freeText: "",
      photoComment: "",
      photos: [],
      data: null,
    },
    distance,
    payment: paymentCode(billing),
    importedAt: new Date().toISOString(),
  };

  return {
    payload,
    inventoryNotes: buildImmoscoutInventoryNotes(payload),
    externalId,
    customer: { fullName, firstName, lastName, email, phone },
    dealNameParts: {
      customerName: fullName || "Unbekannt",
      fromCity: from.city || "",
      toCity: to.city || "",
      moveDate: desiredFrom,
    },
  };
}

// ─── inventory_notes builder ─────────────────────────────────────────────────

const SERVICE_LABELS: Record<string, string> = {
  packing: "Einpacken",
  unpacking: "Auspacken",
  furnitureDismantling: "Möbel Abbau",
  furnitureReassembly: "Möbel Aufbau",
  kitchenLoading: "Küche Abbau",
  kitchenUnloading: "Küche Aufbau",
  boxPacking: "Umzugskartons",
  packingMaterial: "Verpackungsmaterial",
  electricalWork: "Elektroarbeiten",
  storage: "Einlagerung",
  disposal: "Entsorgung",
  noParkingZone: "Halteverbotszone",
};

/** Mirror immoscout-sync.ts inventory formatting, from the parsed payload. */
export function buildImmoscoutInventoryNotes(
  payload: Record<string, unknown>
): string {
  const from = (payload.from ?? {}) as Record<string, unknown>;
  const to = (payload.to ?? {}) as Record<string, unknown>;
  const services = (payload.services ?? {}) as Record<string, boolean>;
  const parts: string[] = [];

  if (payload.category) parts.push(`Typ: ${String(payload.category)}`);
  if (payload.premiumLead) parts.push("Premium-Lead: Ja");
  if (from.livingSpace) parts.push(`Wohnfläche: ${from.livingSpace} m²`);
  if (from.rooms) parts.push(`Zimmer: ${from.rooms}`);
  if (from.persons) parts.push(`Personen: ${from.persons}`);
  if (payload.distance) parts.push(`Entfernung: ${payload.distance} km`);
  if (from.floor) parts.push(`Etage Beladung: ${from.floor}`);
  if (to.floor) parts.push(`Etage Entladung: ${to.floor}`);
  if (from.elevator) parts.push(`Aufzug Beladung: ${from.elevatorInfo || "Ja"}`);
  if (to.elevator) parts.push(`Aufzug Entladung: ${to.elevatorInfo || "Ja"}`);
  if (from.basement) parts.push("Keller: Ja");
  if (from.attic) parts.push("Dachboden: Ja");
  if (from.balcony) parts.push("Balkon: Ja");
  if (from.terrace) parts.push("Terrasse: Ja");

  const activeServices = Object.entries(services)
    .filter(([, v]) => v)
    .map(([k]) => SERVICE_LABELS[k] ?? k);
  if (activeServices.length > 0) parts.push(`Services: ${activeServices.join(", ")}`);

  const fromAddr = [from.street, `${from.zip ?? ""} ${from.city ?? ""}`.trim()]
    .filter((s) => s && String(s).trim())
    .join(", ");
  const toAddr = [to.street, `${to.zip ?? ""} ${to.city ?? ""}`.trim()]
    .filter((s) => s && String(s).trim())
    .join(", ");
  if (fromAddr) parts.push(`Von: ${fromAddr}`);
  if (toAddr) parts.push(`Nach: ${toAddr}`);

  return parts.join("\n");
}
