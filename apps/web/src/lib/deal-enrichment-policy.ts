/**
 * Pure policy for background deal-field enrichment.
 *
 * The job may fill empty Quelle / Anzeige / Verlustgrund fields and may move
 * an open stage forward or to Verloren. It never overwrites a value that is
 * already set (stage is the exception, and only under the stage rules below),
 * never moves a won or paid deal, never moves a stage backwards, and never
 * sends a customer message.
 */

import { createHash } from "crypto";
import { lossReasonProblem } from "@/lib/deal-source";
import { stufenKategorie, type StufenKategorie } from "@/services/lagekarte/status";

export const ENRICHMENT_FIELDS = [
  "source_channel",
  "source_detail",
  "loss_reason",
  "loss_reason_note",
  "stage",
] as const;

export type EnrichmentField = (typeof ENRICHMENT_FIELDS)[number];

export const ENRICHMENT_FIELD_LABELS: Record<EnrichmentField, string> = {
  source_channel: "Quelle / Kanal",
  source_detail: "Anzeige / Detail",
  loss_reason: "Verlustgrund",
  loss_reason_note: "Verlustgrund (Freitext)",
  stage: "Phase",
};

export const DEFAULT_CONFIDENCE_THRESHOLD = 0.85;
export const CEYLAN_CHANNEL_ACCOUNT_PREFIX = "595a5e23";
export const KOTTKE_OPERATING_COMPANY_ID = "5af07382-33b5-4538-a6d5-017132543ac4";
export const CEYLAN_OPERATING_COMPANY_ID = "fbb8a6e6-e869-483b-b47d-b140dc33aa56";

const SELECT_FIELDS = new Set<EnrichmentField>(["source_channel", "loss_reason", "stage"]);
const MIN_QUOTE_CHARS = 4;

const OPEN_RANK: Record<StufenKategorie, number> = {
  open_new: 0,
  open_engaged: 1,
  quoted: 2,
  booked: 3,
  done_unpaid: 4,
  paid: 5,
  lost: 6,
};

const WON_OR_PAID = new Set<StufenKategorie>(["done_unpaid", "paid"]);

/** Customer wording that is explicit enough to move a deal to Verloren. */
const EXPLICIT_LOSS_PHRASES = [
  "haben schon jemanden",
  "schon jemanden gefunden",
  "anderer anbieter",
  "andere firma",
  "umzug faellt aus",
  "umzug abgesagt",
  "umzug storniert",
  "nicht mehr umziehen",
  "ziehen nicht mehr",
  "selbstumzug",
  "machen es selbst",
  "selber machen",
  "brauchen euch nicht",
  "brauchen sie nicht",
  "auftrag an andere",
];

export interface PolicyOption {
  id: string;
  title: string;
}

export interface PolicyStage extends PolicyOption {
  sortOrder: number;
  stageCategory?: string | null;
}

export interface PolicyProposal {
  field: string;
  value: string;
  confidence: number;
  reason: string;
  evidenceQuote: string;
  evidenceSourceId: string;
  evidenceSourceKind: "message" | "note";
}

export interface PolicySource {
  id: string;
  kind: "message" | "note";
  text: string;
  direction?: "inbound" | "outbound" | null;
}

export interface DealEnrichmentPolicyInput {
  proposals: PolicyProposal[];
  /** Stored values. Empty string and null count as empty. Stage holds a status id. */
  currentValues: Partial<Record<EnrichmentField, string | null>>;
  selectOptions: Partial<Record<"source_channel" | "loss_reason", PolicyOption[]>>;
  stages: PolicyStage[];
  sources: PolicySource[];
  threshold: number;
  suggestionsEnabled: boolean;
  autoWriteEnabled: boolean;
  skip: {
    ceylanChannelAccount: boolean;
    internalNumber: boolean;
    humanOwned: boolean;
    aiPaused: boolean;
  };
  rejectedEvidenceKeys: ReadonlySet<string>;
}

export interface AppliedDecision {
  action: "auto_write" | "suggest";
  field: EnrichmentField;
  value: string;
  label: string;
  confidence: number;
  reason: string;
  evidenceQuote: string;
  evidenceSourceId: string;
  evidenceSourceKind: "message" | "note";
  evidenceKey: string;
}

export interface DroppedDecision {
  action: "drop";
  field: string;
  reason: string;
  evidenceKey?: string;
}

export type FieldDecision = AppliedDecision | DroppedDecision;

export interface PolicyResult {
  skipped?: { reason: string };
  decisions: FieldDecision[];
}

export function isEnrichmentField(value: string): value is EnrichmentField {
  return (ENRICHMENT_FIELDS as readonly string[]).includes(value);
}

export function isCeylanChannelAccount(id: string | null | undefined): boolean {
  if (!id) return false;
  return id.toLowerCase().startsWith(CEYLAN_CHANNEL_ACCOUNT_PREFIX);
}

export function normalizeQuote(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function foldGerman(value: string): string {
  return normalizeQuote(value)
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss");
}

export function evidenceQuoteInText(quote: string, text: string): boolean {
  const normalized = normalizeQuote(quote);
  if (normalized.length < MIN_QUOTE_CHARS) return false;
  return normalizeQuote(text).includes(normalized);
}

export function enrichmentEvidenceKey(parts: {
  field: string;
  evidenceSourceKind: string;
  evidenceSourceId: string;
  evidenceQuote: string;
}): string {
  return createHash("sha256")
    .update(
      [parts.field, parts.evidenceSourceKind, parts.evidenceSourceId, normalizeQuote(parts.evidenceQuote)].join(
        "\n"
      )
    )
    .digest("hex");
}

export function hasExplicitLossEvidence(quote: string): boolean {
  const folded = foldGerman(quote);
  return EXPLICIT_LOSS_PHRASES.some((phrase) => folded.includes(foldGerman(phrase)));
}

function isEmpty(value: string | null | undefined): boolean {
  return value == null || value.trim() === "";
}

function clampThreshold(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_CONFIDENCE_THRESHOLD;
  return Math.min(1, Math.max(0, value));
}

function stageCategoryOf(stage: PolicyStage): StufenKategorie | null {
  return stufenKategorie({
    titel: stage.title,
    kategorie: stage.stageCategory ?? null,
  });
}

function isWonOrPaidStage(stage: PolicyStage): boolean {
  const category = stageCategoryOf(stage);
  if (category && WON_OR_PAID.has(category)) return true;
  return /^(won|gewonnen|paid|bezahlt|done|durchgefuehrt|durchgeführt)$/i.test(stage.title.trim());
}

function isLostTitle(title: string): boolean {
  return /^(lost|verloren)$/i.test(title.trim());
}

function resolveSelect(value: string, options: PolicyOption[]): PolicyOption | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const byId = options.find((option) => option.id === trimmed);
  if (byId) return byId;
  const folded = foldGerman(trimmed);
  return options.find((option) => foldGerman(option.title) === folded) ?? null;
}

function resolveStage(value: string, stages: PolicyStage[]): PolicyStage | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const byId = stages.find((stage) => stage.id === trimmed);
  if (byId) return byId;
  const folded = foldGerman(trimmed);
  const matches = stages.filter((stage) => foldGerman(stage.title) === folded);
  if (matches.length === 0) return null;
  return matches.find((stage) => stage.stageCategory) ?? matches[0]!;
}

function optionTitle(
  field: "source_channel" | "loss_reason",
  stored: string | null | undefined,
  options: PolicyOption[] | undefined
): string | null {
  if (!stored || !options) return null;
  return options.find((option) => option.id === stored)?.title ?? null;
}

interface Candidate {
  proposal: PolicyProposal;
  field: EnrichmentField;
  value: string;
  label: string;
  confidence: number;
  evidenceKey: string;
}

function considerProposal(
  proposal: PolicyProposal,
  input: DealEnrichmentPolicyInput
): FieldDecision | Candidate {
  if (!isEnrichmentField(proposal.field)) {
    return { action: "drop", field: proposal.field, reason: "unknown_field" };
  }
  const field = proposal.field;
  const quote = normalizeQuote(proposal.evidenceQuote);
  const reason = proposal.reason.trim();
  const evidenceKey = enrichmentEvidenceKey({
    field,
    evidenceSourceKind: proposal.evidenceSourceKind,
    evidenceSourceId: proposal.evidenceSourceId,
    evidenceQuote: quote,
  });
  if (!reason) return { action: "drop", field, reason: "missing_reason", evidenceKey };
  if (input.rejectedEvidenceKeys.has(evidenceKey)) {
    return { action: "drop", field, reason: "rejected_evidence", evidenceKey };
  }

  const source = input.sources.find(
    (item) => item.id === proposal.evidenceSourceId && item.kind === proposal.evidenceSourceKind
  );
  if (!source || !evidenceQuoteInText(quote, source.text)) {
    return { action: "drop", field, reason: "evidence_not_in_source", evidenceKey };
  }

  let confidence = proposal.confidence;
  if (typeof confidence === "number" && confidence > 1 && confidence <= 100) confidence = confidence / 100;
  if (!Number.isFinite(confidence) || confidence <= 0 || confidence > 1) {
    return { action: "drop", field, reason: "invalid_confidence", evidenceKey };
  }

  const current = input.currentValues[field] ?? null;
  if (field !== "stage" && !isEmpty(current)) {
    return { action: "drop", field, reason: "not_empty", evidenceKey };
  }

  let value = proposal.value.trim();
  let label = value;
  if (field === "stage") {
    const stage = resolveStage(value, input.stages);
    if (!stage) return { action: "drop", field, reason: "unknown_option", evidenceKey };
    const stageDrop = stageMoveProblem(stage, current, input.stages, quote, source);
    if (stageDrop) return { action: "drop", field, reason: stageDrop, evidenceKey };
    value = stage.id;
    label = stage.title;
  } else if (SELECT_FIELDS.has(field)) {
    const options = input.selectOptions[field as "source_channel" | "loss_reason"] ?? [];
    const option = resolveSelect(value, options);
    if (!option) return { action: "drop", field, reason: "unknown_option", evidenceKey };
    value = option.id;
    label = option.title;
  } else if (!value || value.length > 240) {
    return { action: "drop", field, reason: "invalid_text", evidenceKey };
  }

  return { proposal, field, value, label, confidence, evidenceKey };
}

function stageMoveProblem(
  target: PolicyStage,
  currentId: string | null,
  stages: PolicyStage[],
  quote: string,
  source: PolicySource
): string | null {
  const current = currentId ? stages.find((stage) => stage.id === currentId) ?? null : null;
  if (current && isWonOrPaidStage(current)) return "won_or_paid";
  if (current && (stageCategoryOf(current) === "lost" || isLostTitle(current.title))) return "already_lost";
  if (isWonOrPaidStage(target)) return "won_or_paid_target";

  const targetLost = stageCategoryOf(target) === "lost" || isLostTitle(target.title);
  if (targetLost) {
    if (source.kind === "message" && source.direction !== "inbound") return "not_customer_evidence";
    if (!hasExplicitLossEvidence(quote)) return "explicit_loss_evidence";
    return null;
  }

  if (!current) return null;
  if (current.id === target.id) return "unchanged";

  const currentCategory = stageCategoryOf(current);
  const targetCategory = stageCategoryOf(target);
  if (currentCategory && targetCategory) {
    if (OPEN_RANK[targetCategory] <= OPEN_RANK[currentCategory]) return "backwards";
    return null;
  }
  if (target.sortOrder <= current.sortOrder) return "backwards";
  return null;
}

function toApplied(candidate: Candidate, action: "auto_write" | "suggest"): AppliedDecision {
  return {
    action,
    field: candidate.field,
    value: candidate.value,
    label: candidate.label,
    confidence: candidate.confidence,
    reason: candidate.proposal.reason.trim(),
    evidenceQuote: normalizeQuote(candidate.proposal.evidenceQuote),
    evidenceSourceId: candidate.proposal.evidenceSourceId,
    evidenceSourceKind: candidate.proposal.evidenceSourceKind,
    evidenceKey: candidate.evidenceKey,
  };
}

function applied(decision: FieldDecision | undefined): AppliedDecision | null {
  if (!decision || decision.action === "drop") return null;
  return decision;
}

function coupleLoss(decisions: FieldDecision[], input: DealEnrichmentPolicyInput): FieldDecision[] {
  const next = decisions.map((decision) => ({ ...decision })) as FieldDecision[];
  const indexOf = (field: EnrichmentField) => next.findIndex((decision) => decision.field === field);
  const dropAt = (index: number, field: string, reason: string) => {
    if (index < 0) return;
    const current = next[index];
    if (!current || current.action === "drop") return;
    next[index] = { action: "drop", field, reason, evidenceKey: current.evidenceKey };
  };
  const stage = applied(next.find((decision) => decision.field === "stage"));
  const currentStage = input.currentValues.stage
    ? input.stages.find((item) => item.id === input.currentValues.stage) ?? null
    : null;
  const movingToLost = !!stage && isLostTitle(stage.label);
  const alreadyLost =
    !!currentStage && (stageCategoryOf(currentStage) === "lost" || isLostTitle(currentStage.title));

  const reasonIdx = indexOf("loss_reason");
  const noteIdx = indexOf("loss_reason_note");
  const reason = reasonIdx >= 0 ? next[reasonIdx] : undefined;
  const note = noteIdx >= 0 ? next[noteIdx] : undefined;

  if (!movingToLost && !alreadyLost) {
    if (reason) dropAt(reasonIdx, "loss_reason", "loss_reason_without_lost");
    if (note) dropAt(noteIdx, "loss_reason_note", "loss_reason_without_lost");
    return next;
  }

  const currentReasonTitle = optionTitle(
    "loss_reason",
    input.currentValues.loss_reason,
    input.selectOptions.loss_reason
  );
  const reasonDecision = applied(reason);
  const reasonTitle = reasonDecision?.label ?? currentReasonTitle;
  const noteDecision = applied(note);
  const noteText =
    noteDecision?.label ??
    (isEmpty(input.currentValues.loss_reason_note) ? null : input.currentValues.loss_reason_note ?? null);

  if (reasonTitle && foldGerman(reasonTitle) === "sonstiges" && isEmpty(noteText)) {
    dropAt(indexOf("stage"), "stage", "loss_note_required");
    dropAt(reasonIdx, "loss_reason", "loss_note_required");
    return next;
  }

  if (!movingToLost) return next;

  if (!reasonTitle) {
    dropAt(indexOf("stage"), "stage", "loss_reason_required");
    return next;
  }

  const bundle = [stage, reasonDecision, foldGerman(reasonTitle) === "sonstiges" ? noteDecision : null].filter(
    (item): item is AppliedDecision => !!item
  );
  if (bundle.some((item) => item.action === "suggest")) {
    for (const item of bundle) {
      if (item.action !== "auto_write") continue;
      const index = indexOf(item.field);
      if (index >= 0) next[index] = { ...item, action: "suggest" };
    }
  }
  return next;
}

export function evaluateDealEnrichment(input: DealEnrichmentPolicyInput): PolicyResult {
  if (input.skip.ceylanChannelAccount) return { skipped: { reason: "ceylan_channel_account" }, decisions: [] };
  if (input.skip.internalNumber) return { skipped: { reason: "internal_number" }, decisions: [] };
  if (input.skip.humanOwned) return { skipped: { reason: "human_owned" }, decisions: [] };
  if (input.skip.aiPaused) return { skipped: { reason: "ai_paused" }, decisions: [] };
  if (!input.suggestionsEnabled && !input.autoWriteEnabled) {
    return { skipped: { reason: "kill_switch" }, decisions: [] };
  }

  const threshold = clampThreshold(input.threshold);
  const byField = new Map<string, FieldDecision | Candidate>();

  for (const proposal of input.proposals) {
    const outcome = considerProposal(proposal, input);
    if ("action" in outcome) {
      const existing = byField.get(outcome.field);
      if (!existing) byField.set(outcome.field, outcome);
      continue;
    }
    const existing = byField.get(outcome.field);
    if (!existing || "action" in existing || outcome.confidence > existing.confidence) {
      byField.set(outcome.field, outcome);
    }
  }

  const preliminary: FieldDecision[] = [];
  for (const outcome of byField.values()) {
    if ("action" in outcome) {
      preliminary.push(outcome);
      continue;
    }
    const auto = outcome.confidence >= threshold && input.autoWriteEnabled;
    if (auto) {
      preliminary.push(toApplied(outcome, "auto_write"));
      continue;
    }
    if (input.suggestionsEnabled) {
      preliminary.push(toApplied(outcome, "suggest"));
      continue;
    }
    preliminary.push({
      action: "drop",
      field: outcome.field,
      reason: input.autoWriteEnabled ? "below_threshold" : "suggestions_disabled",
      evidenceKey: outcome.evidenceKey,
    });
  }

  return { decisions: coupleLoss(preliminary, input) };
}
