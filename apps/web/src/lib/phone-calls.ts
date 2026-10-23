import { createHmac, timingSafeEqual } from "crypto";

export type CallMatchStatus = "matched" | "unmatched" | "ambiguous" | "no_number";

export const CALL_LIMITS = {
  externalId: 128,
  phone: 40,
  label: 40,
  summary: 2000,
  transcript: 100_000,
  keywords: 12,
  keywordLength: 40,
  durationSeconds: 86_400,
} as const;

export interface TelefonCallInput {
  externalId: string;
  callerRaw: string | null;
  calledRaw: string | null;
  lineLabel: string | null;
  answeredBy: string | null;
  startedAt: Date;
  durationSeconds: number | null;
  transcript: string | null;
  summary: string | null;
  keywords: string[];
}

export interface CallTextFields {
  transcript: string | null;
  summary: string | null;
  keywords: string[];
  durationSeconds: number | null;
}

/** HMAC-SHA256 of the raw body, hex, optional "sha256=" prefix. */
export function verifyTelefonSignature(
  rawBody: string,
  signatureHeader: string | null,
  secret: string
): boolean {
  if (!signatureHeader || !secret) return false;
  const providedHex = signatureHeader.trim().toLowerCase().replace(/^sha256=/, "");
  if (!/^[0-9a-f]{64}$/.test(providedHex)) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  try {
    return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(providedHex, "hex"));
  } catch {
    return false;
  }
}

function optionalText(value: unknown, max: number, label: string): string | null | { error: string } {
  if (value == null) return null;
  if (typeof value !== "string") return { error: `${label} muss Text sein` };
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > max) return { error: `${label} ist zu lang` };
  return trimmed;
}

export function parseTelefonCallPayload(
  body: unknown
): { ok: true; value: TelefonCallInput } | { ok: false; error: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "JSON-Objekt erwartet" };
  }
  const raw = body as Record<string, unknown>;

  if (typeof raw.externalId !== "string" || !/^[\x21-\x7e]{1,128}$/.test(raw.externalId)) {
    return { ok: false, error: "externalId fehlt oder ist ungültig" };
  }

  const caller = optionalText(raw.callerNumber, CALL_LIMITS.phone, "callerNumber");
  if (caller && typeof caller === "object") return { ok: false, error: caller.error };
  const called = optionalText(raw.calledNumber, CALL_LIMITS.phone, "calledNumber");
  if (called && typeof called === "object") return { ok: false, error: called.error };
  const lineLabel = optionalText(raw.lineLabel, CALL_LIMITS.label, "lineLabel");
  if (lineLabel && typeof lineLabel === "object") return { ok: false, error: lineLabel.error };
  const answeredBy = optionalText(raw.answeredBy, CALL_LIMITS.label, "answeredBy");
  if (answeredBy && typeof answeredBy === "object") return { ok: false, error: answeredBy.error };
  const transcript = optionalText(raw.transcript, CALL_LIMITS.transcript, "transcript");
  if (transcript && typeof transcript === "object") return { ok: false, error: transcript.error };
  const summary = optionalText(raw.summary, CALL_LIMITS.summary, "summary");
  if (summary && typeof summary === "object") return { ok: false, error: summary.error };

  if (typeof raw.startedAt !== "string") return { ok: false, error: "startedAt fehlt" };
  const startedAt = new Date(raw.startedAt);
  if (Number.isNaN(startedAt.getTime())) return { ok: false, error: "startedAt ist kein Zeitpunkt" };
  const now = Date.now();
  if (startedAt.getTime() > now + 24 * 60 * 60 * 1000) return { ok: false, error: "startedAt liegt in der Zukunft" };
  if (startedAt.getUTCFullYear() < 2020) return { ok: false, error: "startedAt ist zu alt" };

  let durationSeconds: number | null = null;
  if (raw.durationSeconds != null) {
    if (typeof raw.durationSeconds !== "number" || !Number.isInteger(raw.durationSeconds)) {
      return { ok: false, error: "durationSeconds muss eine ganze Zahl sein" };
    }
    if (raw.durationSeconds < 0 || raw.durationSeconds > CALL_LIMITS.durationSeconds) {
      return { ok: false, error: "durationSeconds ist außerhalb des Bereichs" };
    }
    durationSeconds = raw.durationSeconds;
  }

  const keywords: string[] = [];
  if (raw.keywords != null) {
    if (!Array.isArray(raw.keywords)) return { ok: false, error: "keywords muss eine Liste sein" };
    if (raw.keywords.length > CALL_LIMITS.keywords) return { ok: false, error: "zu viele keywords" };
    for (const item of raw.keywords) {
      if (typeof item !== "string") return { ok: false, error: "keyword muss Text sein" };
      const trimmed = item.trim();
      if (!trimmed) continue;
      if (trimmed.length > CALL_LIMITS.keywordLength) return { ok: false, error: "keyword ist zu lang" };
      keywords.push(trimmed);
    }
  }

  return {
    ok: true,
    value: {
      externalId: raw.externalId,
      callerRaw: caller,
      calledRaw: called,
      lineLabel,
      answeredBy,
      startedAt,
      durationSeconds,
      transcript,
      summary,
      keywords,
    },
  };
}

/** Exactly one live person wins. Several people, or no number, stay unattached. */
export function decideCallMatch(
  callerE164: string | null,
  personIds: string[]
): { status: CallMatchStatus; personRecordId: string | null } {
  if (!callerE164) return { status: "no_number", personRecordId: null };
  const unique = [...new Set(personIds)];
  if (unique.length === 1) return { status: "matched", personRecordId: unique[0] };
  if (unique.length === 0) return { status: "unmatched", personRecordId: null };
  return { status: "ambiguous", personRecordId: null };
}

/**
 * A repeat of the same externalId may fill text that was missing.
 * It never overwrites a transcript, summary, keyword list, or duration.
 */
export function replayFill(
  existing: CallTextFields,
  incoming: CallTextFields
): Partial<CallTextFields> | null {
  const patch: Partial<CallTextFields> = {};
  if (!existing.transcript && incoming.transcript) patch.transcript = incoming.transcript;
  if (!existing.summary && incoming.summary) patch.summary = incoming.summary;
  if (existing.keywords.length === 0 && incoming.keywords.length > 0) patch.keywords = incoming.keywords;
  if (existing.durationSeconds == null && incoming.durationSeconds != null) {
    patch.durationSeconds = incoming.durationSeconds;
  }
  return Object.keys(patch).length > 0 ? patch : null;
}

export { callActivityTitle, matchStatusLabel } from "@/lib/phone-call-text";

export function signTelefonBody(rawBody: string, secret: string): string {
  return createHmac("sha256", secret).update(rawBody).digest("hex");
}
