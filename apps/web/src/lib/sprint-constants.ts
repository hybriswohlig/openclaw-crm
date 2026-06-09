// Shared, client-safe constants for the Sprint layer. NO server/db imports
// so both the API services AND the React components can import from here.
//
// House style: German user-facing copy, and never an em/en dash in any label
// (normal hyphens in compounds are fine).

// ─── Sprint states ────────────────────────────────────────────────────
export const SPRINT_STATES = ["planung", "aktiv", "abgeschlossen"] as const;
export type SprintState = (typeof SPRINT_STATES)[number];

export const SPRINT_STATE_LABELS: Record<SprintState, string> = {
  planung: "Planung",
  aktiv: "Aktiv",
  abgeschlossen: "Abgeschlossen",
};

export function normalizeSprintState(v: unknown): SprintState | null {
  return typeof v === "string" && (SPRINT_STATES as readonly string[]).includes(v)
    ? (v as SprintState)
    : null;
}

// ─── Work type (flow vs build) ────────────────────────────────────────
// 'flow'  = laufender Betrieb (daily moves, dispatch, lead handling).
// 'build' = Wachstum (a finite grow-the-company initiative).
// NULL is treated exactly like 'flow' everywhere.
export const WORK_TYPES = ["flow", "build"] as const;
export type WorkType = (typeof WORK_TYPES)[number];

export const WORK_TYPE_LABELS: Record<WorkType, string> = {
  flow: "Laufender Betrieb",
  build: "Wachstum",
};

export function normalizeWorkType(v: unknown): WorkType | null {
  return typeof v === "string" && (WORK_TYPES as readonly string[]).includes(v)
    ? (v as WorkType)
    : null;
}

// ─── Growth categories ────────────────────────────────────────────────
// The "grow to a big player" lens for a moving company. Stored as a stable
// slug; the label is German. Only meaningful on 'build' tasks.
export const GROWTH_CATEGORIES = [
  { value: "vertrieb", label: "Vertrieb" },
  { value: "marketing", label: "Marketing & Leads" },
  { value: "personal", label: "Personal & Crew" },
  { value: "fuhrpark", label: "Fuhrpark" },
  { value: "standorte", label: "Neue Standorte" },
  { value: "prozesse", label: "Prozesse & SOPs" },
  { value: "partner", label: "Partnerschaften" },
  { value: "preise", label: "Preisstrategie" },
  { value: "qualitaet", label: "Qualitaet & Bewertungen" },
  { value: "software", label: "Software & CRM" },
  { value: "finanzen", label: "Finanzen & Cashflow" },
] as const;

export type GrowthCategory = (typeof GROWTH_CATEGORIES)[number]["value"];

const GROWTH_CATEGORY_VALUES = GROWTH_CATEGORIES.map((c) => c.value) as string[];

export function normalizeGrowthCategory(v: unknown): GrowthCategory | null {
  return typeof v === "string" && GROWTH_CATEGORY_VALUES.includes(v)
    ? (v as GrowthCategory)
    : null;
}

export function growthCategoryLabel(value: string | null | undefined): string | null {
  if (!value) return null;
  return GROWTH_CATEGORIES.find((c) => c.value === value)?.label ?? null;
}
