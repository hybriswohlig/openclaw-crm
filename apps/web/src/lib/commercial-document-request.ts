import type { DocKind, DocumentCopy } from "@openclaw-crm/document-templates";
import { explicitInvoiceDueDay } from "@/lib/invoice-due-date";
import { anpassungBezeichnung, type RechnungAnpassung } from "@/lib/geld";

export const COPY_MAX_CHARS = 4000;

const KINDS = new Set<DocKind>(["KV", "AB", "RE"]);

export type PreviewFormat = "html" | "pdf" | "json";

export interface ParsedPreview {
  kind: DocKind;
  format: PreviewFormat;
  copy: DocumentCopy;
  /** Nur RE: Betrag und Zeilen aus dem Rechnungsschritt, damit die Vorschau zeigt, was gespeichert wird. */
  rechnung?: RechnungEingabeRoh;
}

export interface ParsedRender extends ParsedPreview {
  notifyCustomer: boolean;
  dueDate?: string;
  /** Nur RE: was der Mensch im Rechnungsschritt bestätigt (Plan 9, Rechnung anpassen). */
  rechnung?: RechnungEingabeRoh;
}

/** `rechnung` nach der Typprüfung; den Inhalt der Zeilen prüft `rechnungsPruefung` (Vertrag). */
export interface RechnungEingabeRoh {
  bruttoCent: number | null;
  abweichungGrund: string | null;
  anpassungen?: RechnungAnpassung[];
}

function anpassungenAus(value: unknown): { ok: true; value: RechnungAnpassung[] } | { ok: false; error: string } {
  if (!Array.isArray(value) || value.length > 2) {
    return { ok: false, error: "rechnung.anpassungen muss eine Liste mit höchstens zwei Zeilen sein." };
  }
  const out: RechnungAnpassung[] = [];
  for (const roh of value) {
    if (!roh || typeof roh !== "object" || Array.isArray(roh)) return { ok: false, error: "rechnung.anpassungen: jede Zeile ist ein Objekt." };
    const a = roh as Record<string, unknown>;
    if (a.art !== "nachlass" && a.art !== "aufschlag") return { ok: false, error: "rechnung.anpassungen[].art ist nachlass oder aufschlag." };
    if (typeof a.bezeichnung !== "string") return { ok: false, error: "rechnung.anpassungen[].bezeichnung muss Text sein." };
    if (typeof a.betragCent !== "number" || !Number.isSafeInteger(a.betragCent) || a.betragCent <= 0) {
      return { ok: false, error: "rechnung.anpassungen[].betragCent muss eine ganze Zahl über 0 sein." };
    }
    if (a.prozent !== undefined && a.prozent !== null && (typeof a.prozent !== "number" || !Number.isFinite(a.prozent))) {
      return { ok: false, error: "rechnung.anpassungen[].prozent muss eine Zahl sein." };
    }
    out.push({
      art: a.art,
      bezeichnung: anpassungBezeichnung(a.bezeichnung).slice(0, 200),
      betragCent: a.betragCent,
      ...(typeof a.prozent === "number" ? { prozent: a.prozent } : {}),
    });
  }
  return { ok: true, value: out };
}

/**
 * `rechnung` aus dem Body (RE): `{ bruttoCent?, abweichungGrund?, anpassungen? }`.
 * null = nichts übergeben, sonst die geprüften Felder; ungültig → Fehlertext.
 */
export function parseRechnungEingabe(
  value: unknown
): { ok: true; value: RechnungEingabeRoh | null } | { ok: false; error: string } {
  if (value === undefined || value === null) return { ok: true, value: null };
  if (typeof value !== "object" || Array.isArray(value)) return { ok: false, error: "rechnung muss ein Objekt sein." };
  const r = value as Record<string, unknown>;
  const cent = r.bruttoCent;
  if (cent !== undefined && cent !== null && (typeof cent !== "number" || !Number.isInteger(cent) || cent < 0)) {
    return { ok: false, error: "rechnung.bruttoCent muss eine ganze Zahl ab 0 sein." };
  }
  const grund = r.abweichungGrund;
  if (grund !== undefined && grund !== null && typeof grund !== "string") {
    return { ok: false, error: "rechnung.abweichungGrund muss Text sein." };
  }
  let anpassungen: RechnungAnpassung[] = [];
  if (r.anpassungen !== undefined && r.anpassungen !== null) {
    const a = anpassungenAus(r.anpassungen);
    if (!a.ok) return a;
    anpassungen = a.value;
  }
  return {
    ok: true,
    value: {
      bruttoCent: typeof cent === "number" ? cent : null,
      abweichungGrund: typeof grund === "string" && grund.trim() ? grund.trim().slice(0, 500) : null,
      ...(anpassungen.length > 0 ? { anpassungen } : {}),
    },
  };
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
  const rechnung = kind === "RE" ? parseRechnungEingabe(body.rechnung) : ({ ok: true, value: null } as const);
  if (!rechnung.ok) return { ok: false, status: 400, code: "BAD_REQUEST", error: rechnung.error };
  try {
    return {
      ok: true,
      value: { kind, format, copy: copyFromBody(body, kind), ...(rechnung.value ? { rechnung: rechnung.value } : {}) },
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
  const dueDate = explicitInvoiceDueDay(body.dueDate ?? body.rechnungFaelligAm);
  const rechnung = parseRechnungEingabe(body.rechnung);
  if (!rechnung.ok) return { ok: false, status: 400, code: "BAD_REQUEST", error: rechnung.error };
  return {
    ok: true,
    value: {
      ...preview.value,
      notifyCustomer: body.notifyCustomer === true,
      ...(dueDate ? { dueDate } : {}),
      ...(rechnung.value ? { rechnung: rechnung.value } : {}),
    },
  };
}
