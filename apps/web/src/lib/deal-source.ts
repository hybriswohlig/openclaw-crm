/**
 * Pure deal-source, loss-reason, quoted-stage, and speed-to-lead rules.
 * No database. Safe to import from client components.
 *
 * Deal `source_channel` is intentionally not the people/companies `lead_source`
 * attribute: those option lists differ, and a deal's arrival channel is not
 * the same fact as a person's historical source.
 */
import { aktiveZielStufe } from "./stufen-ziel";
import { isKleinanzeigenEmail } from "@/services/inbox-kleinanzeigen";
import { isImmoscoutLeadEmail } from "@/services/inbox-immoscout";

export const SOURCE_CHANNEL_SLUG = "source_channel";
export const SOURCE_DETAIL_SLUG = "source_detail";
export const SOURCE_RECEIVED_AT_SLUG = "source_received_at";
export const FIRST_REPLY_AT_SLUG = "first_reply_at";
export const LOSS_REASON_SLUG = "loss_reason";
export const LOSS_REASON_NOTE_SLUG = "loss_reason_note";

export const CRM_UI_CLIENT_HEADER = "x-crm-client";
export const CRM_UI_CLIENT_VALUE = "ui";

export const SOURCE_CHANNEL_OPTIONS = [
  "Website-Formular",
  "WhatsApp",
  "Telefon",
  "Google-Profil (GBP)",
  "ImmoScout24 / umzugsfirmen-check",
  "Kleinanzeigen",
  "Empfehlung",
  "Sonstiges",
] as const;

export const LOSS_REASON_OPTIONS = [
  "zu teuer",
  "anderer Anbieter",
  "Selbstumzug",
  "Termin passt nicht",
  "keine Rückmeldung",
  "Umzug abgesagt",
  "Sonstiges",
] as const;

export type SourceChannelTitle = (typeof SOURCE_CHANNEL_OPTIONS)[number];
export type LossReasonTitle = (typeof LOSS_REASON_OPTIONS)[number];

export const QUOTED_REASONS = {
  calculationApply: "Kalkulation ins Angebot übernommen",
  kvDocument: "Kostenvoranschlag gespeichert",
  offerMessage: "Angebotsnachricht gesendet",
} as const;

const IMMO_TITLE: SourceChannelTitle = "ImmoScout24 / umzugsfirmen-check";

const PAYLOAD_IMMO = new Set([
  "immoscout24",
  "immoscout",
  "immobilienscout",
  "is24",
  "umzugsfirmen-check",
  "umzugsfirmencheck",
  "umzugsfirmen_check",
]);
const PAYLOAD_WEBSITE = new Set([
  "website",
  "website-formular",
  "website_form",
  "webform",
  "formular",
  "kontaktformular",
]);
const PAYLOAD_GBP = new Set([
  "gbp",
  "google",
  "google-business",
  "google_business",
  "google-business-profile",
  "google_profil",
  "google-profil",
]);

const KLEINANZEIGEN_TAG_RE = /\[([^|\]\s][^|\]]*)\|([^|\]]+)\|([^\]]+)\]/;
const LATER_STAGE_CATEGORIES = new Set(["quoted", "booked", "done_unpaid", "paid", "lost"]);
const CLOSED_SPEED_CATEGORIES = new Set(["lost", "paid", "done_unpaid"]);

export interface InboundSourceSignals {
  channelType?: string | null;
  fromEmail?: string | null;
  subject?: string | null;
  body?: string | null;
  payloadSource?: string | null;
}

export interface StageRef {
  id: string;
  title: string;
  sortOrder: number;
  stageCategory?: string | null;
  /** Pflicht: eine ausgeblendete Stufe ist nie Ziel (aktiveZielStufe). */
  isActive: boolean | null;
}

function norm(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

/** Map an inbound signal set to one Quelle, or null when nothing is unambiguous. */
export function classifyInboundDealSource(signals: InboundSourceSignals): SourceChannelTitle | null {
  if (norm(signals.channelType) === "whatsapp") return "WhatsApp";

  const payload = norm(signals.payloadSource);
  const from = norm(signals.fromEmail);
  const subject = signals.subject ?? "";
  const body = signals.body ?? "";
  const blob = `${subject}\n${body}`.toLowerCase();

  const kleinanzeigen = isKleinanzeigenEmail(from, subject);
  const immo =
    PAYLOAD_IMMO.has(payload) ||
    /umzugsfirmen-?check/.test(payload) ||
    isImmoscoutLeadEmail(from, subject);
  const gbp =
    PAYLOAD_GBP.has(payload) ||
    from.endsWith("@business.google.com") ||
    from === "business-messages-noreply@google.com" ||
    from.endsWith("@messaging.google.com") ||
    /google unternehmensprofil|google business profile|google my business/.test(blob);
  const website =
    PAYLOAD_WEBSITE.has(payload) ||
    /kontaktformular|website-formular|formularanfrage|neue anfrage (?:über|ueber|von) (?:der |die )?website/.test(blob) ||
    (/(?:^|[^a-z])(?:forms|form|webform)(?:[^a-z]|$)/.test(from) && /anfrage|umzug/.test(blob));

  const hits: SourceChannelTitle[] = [];
  if (kleinanzeigen) hits.push("Kleinanzeigen");
  if (immo) hits.push(IMMO_TITLE);
  if (gbp) hits.push("Google-Profil (GBP)");
  if (website) hits.push("Website-Formular");
  if (hits.length !== 1) return null;
  return hits[0]!;
}

/**
 * Kleinanzeigen subsource: the `[variant|stadtteil|brand]` ad tag first,
 * otherwise a quoted ad title and/or an Anzeigen-ID.
 */
export function extractKleinanzeigenDetail(
  subject: string | null | undefined,
  body?: string | null
): string | null {
  const haystacks = [subject ?? "", body ?? ""];
  for (const haystack of haystacks) {
    const match = haystack.match(KLEINANZEIGEN_TAG_RE);
    if (!match) continue;
    const variant = match[1]!.trim();
    const district = match[2]!.trim();
    const brand = match[3]!.trim();
    if (variant && district && brand) return `${variant}|${district}|${brand}`;
  }

  const text = haystacks.join("\n");
  const quoted = text.match(/[„"“]([^„"“”\n]{3,120})[“"”]/);
  const title = quoted?.[1]?.trim() || null;
  const idMatch = text.match(/(?:anzeigen[-\s]?id|ad[-\s]?id)\s*[:#]?\s*(\d{4,})/i);
  const id = idMatch?.[1] ?? null;
  if (title && id) return `${title} (${id})`;
  if (title) return title;
  if (id) return id;
  return null;
}

/** Portal offer message actually sent to the customer (KV / Angebot, not AB or invoice). */
export function isCustomerOfferMessage(body: string | null | undefined): boolean {
  if (!body) return false;
  if (!/\/s\/[A-Za-z0-9_-]+/.test(body)) return false;
  const lower = body.toLowerCase();
  if (lower.includes("kostenvoranschlag")) return true;
  if (!/\bangebot\b/.test(lower)) return false;
  if (/auftragsbestätigung|auftragsbestaetigung|\brechnung\b/.test(lower)) return false;
  return true;
}

export function lossReasonProblem(input: {
  enforce: boolean;
  movingToLost: boolean;
  reasonTitle: string | null;
  note: string | null;
}): string | null {
  const note = (input.note ?? "").trim();
  const reason = (input.reasonTitle ?? "").trim();
  if (reason.toLowerCase() === "sonstiges" && !note) {
    return "Bei Verlustgrund „Sonstiges“ ist ein Freitext (loss_reason_note) Pflicht.";
  }
  if (input.enforce && input.movingToLost && !reason) {
    return (
      "Beim Verschieben nach Verloren ist ein Verlustgrund Pflicht. " +
      `Wähle einen der Werte: ${LOSS_REASON_OPTIONS.join(", ")}. ` +
      "Bei Sonstiges ist loss_reason_note Pflicht. " +
      "API- und Bot-Aufrufe ohne Kopfzeile X-CRM-Client: ui dürfen den Grund weglassen."
    );
  }
  return null;
}

export function isLostStage(stage: { title?: string | null; stageCategory?: string | null }): boolean {
  if (stage.stageCategory === "lost") return true;
  return /^(lost|verloren)$/i.test(stage.title ?? "");
}

export function needsLossReasonPrompt(input: {
  statuses: Array<{ id: string; title: string; stageCategory?: string | null }>;
  nextStageId: string;
  currentLossReason: unknown;
}): boolean {
  if (input.currentLossReason) return false;
  const status = input.statuses.find((stage) => stage.id === input.nextStageId);
  if (!status) return false;
  return isLostStage(status);
}

/** Quoted status id to move to, or null when the deal must stay put. */
export function decideQuotedAdvance(input: {
  stages: StageRef[];
  currentStageId: string | null;
}): string | null {
  const quoted = aktiveZielStufe(input.stages, "quoted", /^(quoted|angebot)$/i);
  if (!quoted) return null;
  if (!input.currentStageId) return quoted.id;
  const current = input.stages.find((stage) => stage.id === input.currentStageId);
  if (!current) return quoted.id;
  const category = (current.stageCategory ?? "").toLowerCase();
  if (LATER_STAGE_CATEGORIES.has(category)) return null;
  if (/(^|[^a-zäöü])(lost|verloren|paid|bezahlt|won|gewonnen)([^a-zäöü]|$)/i.test(current.title)) {
    return null;
  }
  if (current.sortOrder >= quoted.sortOrder) return null;
  return quoted.id;
}

export type SpeedToLeadSla = "green" | "yellow" | "red";

/** Green under 1 hour, yellow under 24 hours, red after that. */
export function speedToLeadSla(ageMs: number): SpeedToLeadSla {
  if (ageMs < 60 * 60 * 1000) return "green";
  if (ageMs < 24 * 60 * 60 * 1000) return "yellow";
  return "red";
}

export function isClosedSpeedToLeadStage(stage: {
  title: string;
  stageCategory?: string | null;
  isTerminal?: boolean;
}): boolean {
  if (stage.isTerminal) return true;
  if (CLOSED_SPEED_CATEGORIES.has(stage.stageCategory ?? "")) return true;
  return /^(lost|verloren|paid|bezahlt|done|durchgef(?:ü|ue)hrt|gewonnen|won)$/i.test(stage.title);
}

export function operatingCompanyKey(name: string | null | undefined): "kottke" | "ceylan" | null {
  const normalized = (name ?? "").toLowerCase();
  if (normalized.includes("kottke")) return "kottke";
  if (normalized.includes("ceylan")) return "ceylan";
  return null;
}

export function sourceFromMovingLeadPayload(payload: unknown): SourceChannelTitle | null {
  if (!payload || typeof payload !== "object") return null;
  const source = (payload as { source?: unknown }).source;
  if (typeof source !== "string" || !source.trim()) return null;
  return classifyInboundDealSource({ payloadSource: source });
}
