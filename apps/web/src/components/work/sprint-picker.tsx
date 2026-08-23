"use client";

// Sprint selector shown in the header of the dashboard and the reports page:
// "Sprint 2 · 14. Jul – 27. Jul 2025".
//
// Three distinct values, and they must stay distinct: a sprint id, `null` for
// "the active sprint" (the API resolves an omitted sprintId to exactly that),
// and ALL_SPRINTS for "no sprint scoping at all". Collapsing the last two onto
// null makes "Alle Sprints" silently show the active sprint's numbers under a
// label saying otherwise (defect R15).
import { useCallback, useEffect, useState } from "react";
import { ChevronDown, Flag } from "lucide-react";
import type { SprintJSON } from "@/lib/work-types";
import { formatSprintRangeDE } from "@/lib/work-ui";
import { cn } from "@/lib/utils";

/** Sentinel for "do not scope by sprint at all". Never sent as a sprintId. */
export const ALL_SPRINTS = "__all__" as const;

export type SprintSelection = string | null | typeof ALL_SPRINTS;

/**
 * Turns a selection into the query fragment to append. ALL_SPRINTS and the
 * active sprint must produce DIFFERENT queries.
 */
export function sprintQueryParam(value: SprintSelection): string {
  if (value === ALL_SPRINTS) return "sprintId=all";
  if (value) return `sprintId=${encodeURIComponent(value)}`;
  return "";
}

export function SprintPicker({
  value,
  onChange,
  className,
  allowNone = false,
}: {
  value: SprintSelection;
  onChange: (sprintId: SprintSelection) => void;
  className?: string;
  /** Adds the "Alle Sprints" option, which selects ALL_SPRINTS. */
  allowNone?: boolean;
}) {
  const [sprints, setSprints] = useState<SprintJSON[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/sprints", { cache: "no-store" });
      if (!res.ok) return;
      const json = await res.json();
      setSprints((json?.data?.sprints ?? []) as SprintJSON[]);
    } catch {
      // Silent: the header still works, it just shows "Kein Sprint".
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const active = sprints.find((s) => s.state === "aktiv") ?? null;
  const selected =
    value === ALL_SPRINTS ? null : value ? sprints.find((s) => s.id === value) ?? null : active;
  const rangeLabel = selected
    ? formatSprintRangeDE(selected.startDate, selected.endDate)
    : value === ALL_SPRINTS
      ? "ohne Sprintbezug"
      : loading
        ? "lade…"
        : "kein aktiver Sprint";

  return (
    <label
      className={cn(
        "inline-flex items-center gap-2 rounded-[10px] border border-border bg-card px-3 py-[7px]",
        className
      )}
    >
      <Flag className="h-[14px] w-[14px] shrink-0" style={{ color: "var(--kottke-accent)" }} />
      <span className="min-w-0">
        <select
          value={value === ALL_SPRINTS ? ALL_SPRINTS : selected?.id ?? ""}
          onChange={(e) => {
            const v = e.target.value;
            onChange(v === ALL_SPRINTS ? ALL_SPRINTS : v || null);
          }}
          className="max-w-[220px] cursor-pointer appearance-none bg-transparent pr-4 text-[13px] font-medium text-foreground outline-none"
          aria-label="Sprint auswählen"
        >
          {allowNone && <option value={ALL_SPRINTS}>Alle Sprints</option>}
          {!allowNone && !selected && <option value="">Kein Sprint</option>}
          {sprints.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
              {s.state === "aktiv" ? " (aktiv)" : s.state === "planung" ? " (Planung)" : " (abgeschlossen)"}
            </option>
          ))}
        </select>
        <span className="ml-1 hidden text-[12px] sm:inline" style={{ color: "var(--muted-foreground)" }}>
          · {rangeLabel}
        </span>
      </span>
      <ChevronDown className="h-[14px] w-[14px] shrink-0" style={{ color: "var(--muted-foreground)" }} />
    </label>
  );
}
