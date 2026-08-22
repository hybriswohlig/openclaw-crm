// Wizard draft. Everything the five steps collect lives in this one object,
// mirrored into localStorage on every change so a reload never loses work
// (Spec §8.3). Nothing is written to the server before "Projekt erstellen".
import { offsetDaysToDate, phaseEndOffset, toIsoDay } from "@/lib/work-metrics";
import { eurosToCents } from "@/lib/work-ui";

export const WIZARD_DRAFT_KEY = "kottke:projectWizardDraft";

/**
 * Bump whenever the draft shape changes. A stored draft of a different version
 * is discarded instead of restored: `setDraft(stored)` replaces state wholesale,
 * and one missing array then makes ProjectPreviewRail do
 * `draft.milestones.length` on undefined → TypeError → React unmounts the tree
 * → permanent white screen on every reload until someone clears the key in
 * DevTools (defect R2).
 */
export const WIZARD_DRAFT_VERSION = 1;

/** Stable per-row id. Index keys break every list that has a delete button. */
export function draftId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `d${Date.now()}${Math.random().toString(16).slice(2)}`;
}

export interface DraftTask {
  id: string;
  title: string;
  description: string;
  /** Days relative to the project start — turned into a date on submit. */
  offsetDays: number;
  priority: string;
}

export interface DraftPhase {
  id: string;
  name: string;
  description: string;
  startOffsetDays: number;
  durationDays: number;
  tasks: DraftTask[];
}

export interface DraftMilestone {
  id: string;
  name: string;
  /** Id of a DraftPhase, or null. NOT an index — indices shift on delete. */
  phaseId: string | null;
  offsetDays: number;
}

export interface DraftRisk {
  id: string;
  title: string;
  description: string;
  severity: string;
  mitigation: string;
}

export interface DraftBudgetEntry {
  id: string;
  label: string;
  amountEuros: string;
}

export interface DraftMember {
  userId: string;
  role: string;
}

export interface WizardDraft {
  version: number;
  step: number;
  name: string;
  shortDescription: string;
  category: string;
  priority: string;
  startDate: string;
  endDate: string;
  ownerUserId: string;
  problemStatement: string;
  goalStatement: string;
  successCriteria: string;
  scopeIn: string[];
  scopeOut: string[];
  phases: DraftPhase[];
  milestones: DraftMilestone[];
  risks: DraftRisk[];
  budgetPlannedEuros: string;
  budgetEntries: DraftBudgetEntry[];
  members: DraftMember[];
  sprintId: string;
  /** true once the AI call for this draft has run (successfully or not). */
  aiRan: boolean;
  savedAt: string;
}

export function emptyDraft(): WizardDraft {
  const today = new Date();
  const iso = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const end = new Date(today);
  end.setDate(end.getDate() + 90);
  return {
    version: WIZARD_DRAFT_VERSION,
    step: 1,
    name: "",
    shortDescription: "",
    category: "",
    priority: "mittel",
    startDate: iso(today),
    endDate: iso(end),
    ownerUserId: "",
    problemStatement: "",
    goalStatement: "",
    successCriteria: "",
    scopeIn: [],
    scopeOut: [],
    phases: [],
    milestones: [],
    risks: [],
    budgetPlannedEuros: "",
    budgetEntries: [],
    members: [],
    sprintId: "",
    aiRan: false,
    savedAt: new Date().toISOString(),
  };
}

/**
 * Offset in days from the project start → an ISO date string.
 * The arithmetic itself lives in offsetDaysToDate (lib/work-metrics.ts) and is
 * unit-tested there — spec §14 names the wizard offset conversion as a tested
 * path, so this must stay a thin wrapper and never re-implement the maths.
 */
export function offsetToISO(startDate: string, offsetDays: number): string {
  const base = new Date(`${startDate}T00:00:00`);
  if (Number.isNaN(base.getTime())) return startDate;
  const d = offsetDaysToDate(base, offsetDays);
  return toIsoDay(d);
}

/**
 * Inclusive end of a phase as an ISO date. Defers to phaseEndOffset — the same
 * function Phase 2's materializeProjectPlan uses — so a 14-day phase ends on
 * the 14th day in the wizard exactly as it does through MCP. Re-deriving this
 * is what produced two off-by-one variants (defect R7).
 */
export function phaseEndISO(startDate: string, startOffsetDays: number, durationDays: number): string {
  return offsetToISO(startDate, phaseEndOffset(startOffsetDays, durationDays));
}

/** Offsets are days after the project start; a negative one is always a typo. */
export function clampOffset(value: unknown): number {
  const n = Math.trunc(Number(value));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Durations are at least one day. */
export function clampDuration(value: unknown): number {
  const n = Math.trunc(Number(value));
  return Number.isFinite(n) && n > 1 ? n : 1;
}

/**
 * Case-insensitive de-duplication that keeps the first spelling. Used to
 * merge AI-suggested scope lines into the draft without creating "Angebote
 * erstellen" / "angebote erstellen" duplicates.
 */
export function dedupe(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    const k = v.trim().toLowerCase();
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(v.trim());
  }
  return out;
}

/**
 * I4: a blank budget field means "kein Budget" and is fine. A non-blank one
 * must parse under the same German rule eurosToCents enforces everywhere
 * else (I3) — otherwise the wizard used to happily let "12500,00" sail
 * through the Budgetrahmen field, echo it back unchanged on the review
 * step, and then silently create the project with no budget at all once
 * its own weak `Number()` parser choked on the comma at submit time.
 */
export function isBudgetAmountValid(value: string): boolean {
  return value.trim() === "" || eurosToCents(value) != null;
}

/** Gate for leaving wizard step 3: every budget amount on the step must be valid. */
export function isBudgetStepValid(draft: Pick<WizardDraft, "budgetPlannedEuros" | "budgetEntries">): boolean {
  return (
    isBudgetAmountValid(draft.budgetPlannedEuros) &&
    draft.budgetEntries.every((b) => isBudgetAmountValid(b.amountEuros))
  );
}

export const WIZARD_STEPS = [
  { n: 1, label: "Grundlagen" },
  { n: 2, label: "Ziel & Scope" },
  { n: 3, label: "Planung" },
  { n: 4, label: "Team & Ressourcen" },
  { n: 5, label: "Überprüfung" },
] as const;
