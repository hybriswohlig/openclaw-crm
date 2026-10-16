import type { DocKind, DocumentCopy } from "@openclaw-crm/document-templates";

export const COPY_MAX_CHARS = 4000;

const KINDS = new Set<DocKind>(["KV", "AB", "RE"]);

export type PreviewFormat = "html" | "pdf" | "json";

export interface ParsedPreview {
  kind: DocKind;
  format: PreviewFormat;
  copy: DocumentCopy;
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
    return { ok: true, value: { kind, format, copy: copyFromBody(body, kind) } };
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
