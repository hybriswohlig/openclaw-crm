// Client-safe task priority constants (no server/db imports), shared by the
// API services and the React components. House style: German labels, no
// em/en dashes.

export const PRIORITIES = [
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
