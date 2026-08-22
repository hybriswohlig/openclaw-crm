"use client";

// Sprint timeline (Spec §8.1). A CSS grid of day columns carries one row per
// project; each task is a positioned DOM element so it can own hover, click
// and avatars. Dependency arrows are drawn into an absolutely positioned SVG
// overlay whose coordinates come from getBoundingClientRect of those bars,
// recomputed by a ResizeObserver (Task 17). The whole grid lives in its own
// overflow-x:auto container so the page itself never scrolls sideways.
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { AlertTriangle, ChevronLeft, ChevronRight } from "lucide-react";
import type { TimelineBarJSON, TimelineJSON } from "@/lib/work-types";
import {
  assignBarLanes,
  timelineBarStyle,
  todayColumnIndex,
  toDate,
  deadlineLabel,
} from "@/lib/work-ui";
import { AvatarStack } from "./avatar-stack";
import { EmptyState, ErrorLine, LoadingLine } from "./empty-state";
import { cn } from "@/lib/utils";

const DEFAULT_DAY_WIDTH = 44;
const ROW_LABEL_WIDTH = 168;
const BAR_HEIGHT = 26;
const LANE_GAP = 4;
const ROW_PADDING = 8;

/** Bar colours by state. All four tokens are theme-independent (plan R1). */
const BAR_TOKEN: Record<TimelineBarJSON["state"], string> = {
  geplant: "var(--info)",
  in_arbeit: "var(--kottke-accent)",
  erledigt: "var(--ok)",
  ueberfaellig: "var(--danger)",
};

const BAR_LABEL: Record<TimelineBarJSON["state"], string> = {
  geplant: "Geplant",
  in_arbeit: "In Arbeit",
  erledigt: "Erledigt",
  ueberfaellig: "Überfällig",
};

export interface SprintTimelineProps {
  data: TimelineJSON | null;
  loading?: boolean;
  error?: boolean;
  onTaskClick?: (taskId: string) => void;
  /** Highlighted bar — the project tab uses it to anchor the dependency panel. */
  selectedTaskId?: string | null;
  onSelectTask?: (taskId: string | null) => void;
  dayWidth?: number;
  className?: string;
}

// NOTE: the row cap is a SERVER concern. getSprintTimeline takes a
// maxBarsPerRow option, so callers pass it as a query parameter on
// /api/v1/work/timeline and the payload comes back with row.truncatedBars.
// This component must never slice `row.bars` itself, or the "+n weitere"
// count would disagree with what was actually dropped.

export function SprintTimeline({
  data,
  loading = false,
  error = false,
  onTaskClick,
  selectedTaskId = null,
  onSelectTask,
  dayWidth = DEFAULT_DAY_WIDTH,
  className,
}: SprintTimelineProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const barRefs = useRef(new Map<string, HTMLElement>());
  const todayRef = useRef<HTMLDivElement>(null);

  const days = useMemo(
    () => (data?.days ?? []).map((d) => toDate(d)).filter((d): d is Date => d !== null),
    [data]
  );
  const todayIndex = useMemo(() => todayColumnIndex(days), [days]);
  const gridWidth = days.length * dayWidth;

  // Navigation is pure scrolling — the server owns the window (it is the
  // sprint), so "‹ / ›" move the viewport by a week and "Heute" centres the
  // current column. No extra API contract needed.
  const scrollByDays = useCallback(
    (delta: number) => {
      scrollRef.current?.scrollBy({ left: delta * dayWidth, behavior: "smooth" });
    },
    [dayWidth]
  );

  const scrollToToday = useCallback(() => {
    const el = todayRef.current;
    const box = scrollRef.current;
    if (!el || !box) return;
    box.scrollTo({
      left: Math.max(0, el.offsetLeft - box.clientWidth / 2 + dayWidth / 2),
      behavior: "smooth",
    });
  }, [dayWidth]);

  // On first paint, put today in view instead of the window start.
  useEffect(() => {
    if (todayIndex >= 0) scrollToToday();
  }, [todayIndex, scrollToToday]);

  const header = (
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
      <div className="min-w-0">
        <h3 className="k-display m-0" style={{ fontSize: 18, fontWeight: 500 }}>
          Sprint Timeline
        </h3>
        <p className="mt-0.5 text-[12px]" style={{ color: "var(--muted-foreground)" }}>
          Aufgaben mit Datum, nach Projekt gruppiert
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <button
          type="button"
          onClick={scrollToToday}
          disabled={todayIndex < 0}
          className="rounded-lg border border-border px-2.5 py-1 text-[12px] font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-40"
        >
          Heute
        </button>
        <button
          type="button"
          onClick={() => scrollByDays(-7)}
          aria-label="Eine Woche zurück"
          className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-border text-muted-foreground transition-colors hover:bg-muted"
        >
          <ChevronLeft className="h-[15px] w-[15px]" />
        </button>
        <button
          type="button"
          onClick={() => scrollByDays(7)}
          aria-label="Eine Woche vor"
          className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-border text-muted-foreground transition-colors hover:bg-muted"
        >
          <ChevronRight className="h-[15px] w-[15px]" />
        </button>
      </div>
    </div>
  );

  if (loading) {
    return (
      <div className={cn("k-card p-5", className)}>
        {header}
        <LoadingLine label="Timeline wird geladen…" />
      </div>
    );
  }
  if (error) {
    return (
      <div className={cn("k-card p-5", className)}>
        {header}
        <ErrorLine label="Timeline konnte nicht geladen werden." />
      </div>
    );
  }
  if (!data || days.length === 0 || data.rows.length === 0) {
    return (
      <div className={cn("k-card p-5", className)}>
        {header}
        <EmptyState
          title="Nichts in diesem Sprintfenster"
          hint="Sobald Aufgaben ein Start- oder Fälligkeitsdatum im Sprintzeitraum haben, erscheinen sie hier als Balken."
        />
      </div>
    );
  }

  return (
    <div className={cn("k-card flex flex-col p-5", className)}>
      {header}

      <div ref={scrollRef} className="-mx-1 overflow-x-auto px-1 pb-1">
        <div style={{ minWidth: ROW_LABEL_WIDTH + gridWidth }}>
          {/* ── Tagesspaltenkopf ─────────────────────────────────── */}
          <div className="flex">
            <div style={{ width: ROW_LABEL_WIDTH }} className="shrink-0" />
            <div className="flex" style={{ width: gridWidth }}>
              {days.map((d, i) => {
                const isToday = i === todayIndex;
                const isWeekend = d.getDay() === 0 || d.getDay() === 6;
                return (
                  <div
                    key={d.toISOString()}
                    ref={isToday ? todayRef : undefined}
                    className="shrink-0 pb-1 text-center"
                    style={{
                      width: dayWidth,
                      background: isToday
                        ? "color-mix(in oklch, var(--kottke-accent) 10%, transparent)"
                        : isWeekend
                          ? "var(--muted)"
                          : "transparent",
                      borderTopLeftRadius: 6,
                      borderTopRightRadius: 6,
                    }}
                  >
                    <div
                      className="k-mono"
                      style={{
                        fontSize: 9.5,
                        letterSpacing: "0.06em",
                        color: isToday ? "var(--kottke-accent)" : "var(--muted-foreground)",
                      }}
                    >
                      {d.toLocaleDateString("de-DE", { weekday: "short" })}
                    </div>
                    <div
                      className="k-display"
                      style={{
                        fontSize: 14,
                        lineHeight: 1.2,
                        color: isToday ? "var(--kottke-accent)" : "var(--foreground)",
                        fontWeight: isToday ? 600 : 400,
                      }}
                    >
                      {d.getDate()}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Task 16 fügt hier die Projektzeilen ein, Task 17 das SVG-Overlay. */}
        </div>
      </div>

      {/* Task 18 fügt hier die Legende ein. */}
    </div>
  );
}
