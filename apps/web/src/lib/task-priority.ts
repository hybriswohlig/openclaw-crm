// Client-safe task priority constants (no server/db imports), shared by the
// API services and the React components. House style: German labels, no
// em/en dashes.

// Four steps, ordered high to low — the array order IS the display order in
// the task dialog and the project wizard. 'sehr_hoch' was added with the
// Projekte module and applies to projects and tasks alike; the three older
// values are unchanged, so every stored row stays valid.
export const PRIORITIES = [
  { value: "sehr_hoch", label: "Sehr hoch", dot: "#b91c1c" },
  { value: "hoch", label: "Hoch", dot: "#dc2626" },
  { value: "mittel", label: "Mittel", dot: "#d97706" },
  { value: "niedrig", label: "Niedrig", dot: "#64748b" },
] as const;

export type Priority = (typeof PRIORITIES)[number]["value"];

const PRIORITY_VALUES = PRIORITIES.map((p) => p.value) as string[];

export function normalizePriority(v: unknown): Priority | null {
  return typeof v === "string" && PRIORITY_VALUES.includes(v)
    ? (v as Priority)
    : null;
}

export function priorityMeta(value: string | null | undefined) {
  if (!value) return null;
  return PRIORITIES.find((p) => p.value === value) ?? null;
}
