import {
  parseEuroToCents,
  parseGermanDecimal,
  parsePersonSalutation,
  type DocKind,
  type DocumentCopy,
  type DocumentOptions,
  type FreeLineInput,
  type Section35a,
} from "@openclaw-crm/document-templates";

export const COPY_MAX_CHARS = 4000;

const KINDS = new Set<DocKind>(["KV", "AB", "RE"]);

export type PreviewFormat = "html" | "pdf" | "json";

export interface ParsedPreview {
  kind: DocKind;
  format: PreviewFormat;
  copy: DocumentCopy;
  options: DocumentOptions;
}

export interface ParsedRender extends ParsedPreview {
  notifyCustomer: boolean;
}

export type ParseFailure = { ok: false; status: 400 | 409; code: string; error: string };
export type ParseSuccess<T> = { ok: true; value: T };

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function parseKind(value: unknown): DocKind | null {
  if (typeof value !== "string") return null;
  const upper = value.trim().toUpperCase();
  return KINDS.has(upper as DocKind) ? (upper as DocKind) : null;
}

function readText(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") {
    throw new Error(`${field} must be plain text`);
  }
  const cleaned = value.replace(/\u0000/g, "").replace(/\r\n/g, "\n").trim();
  if (!cleaned) return undefined;
  if (cleaned.length > COPY_MAX_CHARS) {
    throw new Error(`${field} is longer than ${COPY_MAX_CHARS} characters`);
  }
  return cleaned;
}

/**
 * intro / closing / remarks, optionally nested under KV, AB or RE.
 * Price fields, notes and anweisung are ignored — they are not copy.
 */
export function parseDocumentCopy(value: unknown, kind: DocKind): DocumentCopy {
  if (value === undefined || value === null) return {};
  if (!isRecord(value)) throw new Error("copy must be an object");
  const flat = {
    intro: readText(value.intro, "intro"),
    closing: readText(value.closing, "closing"),
    remarks: readText(value.remarks, "remarks"),
  };
  const nested = value[kind];
  if (nested === undefined || nested === null) return flat;
  if (!isRecord(nested)) throw new Error(`${kind} copy must be an object`);
  return {
    intro: readText(nested.intro, `${kind}.intro`) ?? flat.intro,
    closing: readText(nested.closing, `${kind}.closing`) ?? flat.closing,
    remarks: readText(nested.remarks, `${kind}.remarks`) ?? flat.remarks,
  };
}

function copyFromBody(body: Record<string, unknown>, kind: DocKind): DocumentCopy {
  const raw = body.copy ?? body.document_copy;
  return parseDocumentCopy(raw, kind);
}

/**
 * Kottke RE and AB use the in-repo template even when the caller still says
 * renderer=vps. Ceylan, and a Kottke KV without renderer=crm, stay on the VPS job.
 */
export function kottkeUsesInRepoRenderer(input: {
  renderer?: string | null;
  firma?: string | null;
  documentType?: string | null;
}): boolean {
  if ((input.renderer ?? "").trim().toLowerCase() === "crm") return true;
  const firma = (input.firma ?? "").trim().toLowerCase();
  const kind = (input.documentType ?? "").trim().toUpperCase();
  return firma === "kottke" && (kind === "RE" || kind === "AB");
}

/** "sofort", TT.MM.JJJJ or YYYY-MM-DD. */
export function normalizeDueDate(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (/^sofort$/i.test(trimmed)) return "sofort";
  const german = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(trimmed);
  if (german) {
    return `${german[3]}-${german[2].padStart(2, "0")}-${german[1].padStart(2, "0")}`;
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) return trimmed.slice(0, 10);
  return undefined;
}

function readDue(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const parsed = normalizeDueDate(value);
  if (!parsed) {
    throw new Error(`${field} must be "sofort" or a date (TT.MM.JJJJ or YYYY-MM-DD)`);
  }
  return parsed;
}

function textField(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/**
 * Hourly or plain positions. A stundensatz payload becomes one hourly line.
 * It never invents "Pauschale" or "Umzug von X nach Y".
 */
function linesFromPreise(
  preise: unknown,
  source: Record<string, unknown>
): FreeLineInput[] | undefined {
  if (!isRecord(preise) || preise.modell !== "stundensatz") return undefined;
  const hours = parseGermanDecimal(preise.stunden_geschaetzt ?? preise.stunden ?? preise.hours);
  const workers = parseGermanDecimal(preise.helfer_anzahl ?? preise.mitarbeiter ?? preise.workers);
  let rate = parseGermanDecimal(
    preise.stundensatz_eur ?? preise.stundensatz ?? preise.rate ?? preise.stundensatz_gesamt_eur
  );
  if (rate == null) {
    const perHelper = parseGermanDecimal(preise.stundensatz_helfer_eur);
    const transporter = parseGermanDecimal(preise.stundensatz_transporter_eur) ?? 0;
    if (perHelper != null && workers != null) rate = perHelper * workers + transporter;
  }
  if (hours == null || rate == null) return undefined;
  const raw =
    textField(source.positionDescription) ||
    textField(source.beschreibung) ||
    textField(preise.beschreibung) ||
    textField(preise.titel) ||
    "Arbeitszeit";
  const description = /pauschale/i.test(raw) || /umzug von\s+.+\s+nach\s+/i.test(raw) ? "Arbeitszeit" : raw;
  return [
    {
      description,
      workers: workers ?? undefined,
      hours,
      rate,
      includesTravel: preise.inkl_anfahrt !== false && preise.includesTravel !== false,
    },
  ];
}

function readLineItems(value: unknown): FreeLineInput[] {
  if (!Array.isArray(value)) throw new Error("lineItems must be an array");
  return value.map((entry, index) => {
    if (!isRecord(entry)) throw new Error(`lineItems[${index}] must be an object`);
    const hours = parseGermanDecimal(entry.hours ?? entry.stunden);
    const workers = parseGermanDecimal(entry.workers ?? entry.mitarbeiter ?? entry.helfer);
    const rate = parseGermanDecimal(entry.rate ?? entry.stundensatz);
    const quantity = parseGermanDecimal(entry.quantity ?? entry.menge);
    const unitRate = entry.unitRate ?? entry.einzelpreis ?? entry.rate;
    const amountCents =
      typeof entry.amountCents === "number" && Number.isFinite(entry.amountCents)
        ? Math.round(entry.amountCents)
        : undefined;
    return {
      description: textField(entry.description) ?? textField(entry.titel) ?? textField(entry.bezeichnung),
      quantity: quantity ?? undefined,
      unitRate: typeof unitRate === "string" || typeof unitRate === "number" ? unitRate : undefined,
      workers: workers ?? undefined,
      hours: hours ?? undefined,
      rate: rate ?? undefined,
      includesTravel: entry.includesTravel === true || entry.inkl_anfahrt === true || entry.inklAnfahrt === true,
      amountCents,
    };
  });
}

function readSection35a(value: unknown): Section35a | undefined {
  if (value === undefined || value === null || value === false) return undefined;
  if (!isRecord(value)) throw new Error("section35a must be an object");
  if (value.enabled === false) return undefined;
  const cents =
    typeof value.labourCents === "number"
      ? Math.round(value.labourCents)
      : typeof value.amountCents === "number"
        ? Math.round(value.amountCents)
        : parseEuroToCents(value.amount ?? value.labourAmount ?? value.arbeitskosten);
  if (cents == null || cents < 0) throw new Error("section35a needs labourCents or amount");
  const serviceAddress =
    textField(value.serviceAddress) ?? textField(value.leistungsort) ?? textField(value.address);
  return { labourCents: cents, serviceAddress };
}

function readPaymentMethods(value: unknown): string[] | undefined {
  if (value === undefined || value === null) return undefined;
  const list = Array.isArray(value) ? value : [value];
  const methods = list.filter((item): item is string => typeof item === "string" && item.trim() !== "");
  return methods.length > 0 ? methods : undefined;
}

/** Optional invoice fields. Unknown price blobs are not copied through. */
export function parseDocumentOptions(body: Record<string, unknown>): DocumentOptions {
  const kunde = isRecord(body.kunde) ? body.kunde : {};
  const details = isRecord(body.document_details) ? body.document_details : {};
  const lineSource = body.lineItems ?? body.positionen;
  const lineItems = Array.isArray(lineSource)
    ? readLineItems(lineSource)
    : linesFromPreise(body.preise, body);
  const allowCard =
    typeof body.allowCard === "boolean"
      ? body.allowCard
      : details.cardAgreed === false
        ? false
        : undefined;
  const dueDate = readDue(body.dueDate ?? body.faelligkeit ?? body.faellig, "dueDate");
  const salutation = parsePersonSalutation(
    body.salutation ?? body.anrede ?? body.gender ?? body.geschlecht ?? kunde.anrede ?? kunde.geschlecht ?? kunde.salutation
  );
  const section35a = readSection35a(body.section35a ?? body.paragraph35a ?? body.estg35a);
  const invoiceNumber = textField(body.invoiceNumber) ?? textField(body.rechnungsnummer);
  const paymentMethods = readPaymentMethods(body.paymentMethods);
  const options: DocumentOptions = {};
  if (lineItems && lineItems.length > 0) options.lineItems = lineItems;
  if (allowCard !== undefined) options.allowCard = allowCard;
  if (paymentMethods) options.paymentMethods = paymentMethods;
  if (dueDate) options.dueDate = dueDate;
  if (salutation) options.salutation = salutation;
  if (section35a) options.section35a = section35a;
  if (invoiceNumber) options.invoiceNumber = invoiceNumber;
  return options;
}

function parseFormat(value: unknown): PreviewFormat | null {
  if (value === undefined || value === null || value === "") return "html";
  if (value === "html" || value === "pdf" || value === "json") return value;
  return null;
}

export function parsePreviewBody(body: unknown): ParseSuccess<ParsedPreview> | ParseFailure {
  if (!isRecord(body)) {
    return { ok: false, status: 400, code: "BAD_REQUEST", error: "Invalid JSON body" };
  }
  const kind = parseKind(body.documentType ?? body.document_type);
  if (!kind) {
    return {
      ok: false,
      status: 400,
      code: "BAD_REQUEST",
      error: "documentType must be KV, AB or RE",
    };
  }
  const format = parseFormat(body.format);
  if (!format) {
    return { ok: false, status: 400, code: "BAD_REQUEST", error: "format must be html, pdf or json" };
  }
  try {
    return {
      ok: true,
      value: { kind, format, copy: copyFromBody(body, kind), options: parseDocumentOptions(body) },
    };
  } catch (err) {
    return {
      ok: false,
      status: 400,
      code: "BAD_REQUEST",
      error: err instanceof Error ? err.message : "Invalid copy",
    };
  }
}

/**
 * The CRM renderer runs only when renderer is exactly "crm".
 * Missing or "vps" keeps the historical job path and stores nothing here.
 */
export function parseRenderBody(body: unknown): ParseSuccess<ParsedRender> | ParseFailure {
  if (!isRecord(body)) {
    return { ok: false, status: 400, code: "BAD_REQUEST", error: "Invalid JSON body" };
  }
  if (body.renderer !== "crm") {
    return {
      ok: false,
      status: 409,
      code: "RENDERER_REQUIRED",
      error:
        'renderer must be "crm". The default path is still the VPS job: crm_generate_document without renderer, or POST /api/tools/run.',
    };
  }
  const preview = parsePreviewBody(body);
  if (!preview.ok) return preview;
  return {
    ok: true,
    value: {
      ...preview.value,
      notifyCustomer: body.notifyCustomer === true,
    },
  };
}
