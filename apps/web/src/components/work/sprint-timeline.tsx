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
  /** Double click opens; single click only selects (see the project tab). */
  onBarDoubleClick?: (taskId: string) => void;
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
  onBarDoubleClick,
  dayWidth = DEFAULT_DAY_WIDTH,
  className,
}: SprintTimelineProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const barRefs = useRef(new Map<string, HTMLElement>());
  const todayRef = useRef<HTMLDivElement>(null);

  // On a phone 44 px per day would mean a 616 px track for a two-week
  // sprint; 30 px keeps a whole week on screen without breaking the layout.
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 640px)");
    const apply = () => setNarrow(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);
  const effectiveDayWidth = narrow ? Math.min(dayWidth, 30) : dayWidth;

  const markerId = `timeline-arrow-${useId().replace(/:/g, "")}`;

  const days = useMemo(
    () => (data?.days ?? []).map((d) => toDate(d)).filter((d): d is Date => d !== null),
    [data]
  );
  const todayIndex = useMemo(() => todayColumnIndex(days), [days]);
  const gridWidth = days.length * effectiveDayWidth;

  // Per row: sort by start, then stack into lanes so overlapping bars never
  // cover each other. The cap already happened server-side — `truncatedBars`
  // says how many were dropped and is surfaced as "+n weitere" (Risk R5).
  const rows = useMemo(() => {
    return (data?.rows ?? []).map((row) => {
      const visible = [...row.bars].sort(
        (a, b) => a.startIndex - b.startIndex || a.endIndex - b.endIndex
      );
      const lanes = assignBarLanes(visible);
      const laneCount = lanes.length === 0 ? 1 : Math.max(...lanes) + 1;
      return {
        ...row,
        visible,
        lanes,
        hidden: row.truncatedBars,
        // Dated tasks outside the window are a DIFFERENT number: a project
        // with 30 dated tasks and 8 in the window has 22 here and possibly 0
        // in truncatedBars. Showing only the cap claims a completeness the
        // row does not have (defect W12).
        outside: row.outOfWindowBars ?? 0,
        height: laneCount * BAR_HEIGHT + (laneCount - 1) * LANE_GAP + ROW_PADDING * 2,
      };
    });
  }, [data]);

  const setBarRef = useCallback((taskId: string, el: HTMLElement | null) => {
    if (el) barRefs.current.set(taskId, el);
    else barRefs.current.delete(taskId);
  }, []);

  const [arrows, setArrows] = useState<Array<{ id: string; d: string }>>([]);
  const [overlay, setOverlay] = useState({ width: 0, height: 0 });

  const recomputeArrows = useCallback(() => {
    const root = contentRef.current;
    if (!root || !data) {
      setArrows([]);
      return;
    }
    const base = root.getBoundingClientRect();
    setOverlay({ width: base.width, height: base.height });

    const next: Array<{ id: string; d: string }> = [];
    for (const dep of data.dependencies) {
      // Direction is fixed: the arrow runs FROM the predecessor TO the
      // successor, so the arrowhead lands on the task that waits. Never swap
      // these two lookups — `from` must be the predecessor.
      const from = barRefs.current.get(dep.predecessorTaskId);
      const to = barRefs.current.get(dep.successorTaskId);
      // Only draw when BOTH bars are actually rendered (Risk R5) — a
      // dependency onto a capped-away or out-of-window task is skipped.
      if (!from || !to) continue;
      const a = from.getBoundingClientRect();
      const b = to.getBoundingClientRect();
      // Right edge of the predecessor → left edge of the successor.
      const x1 = a.right - base.left;
      const y1 = a.top - base.top + a.height / 2;
      const x2 = b.left - base.left;
      const y2 = b.top - base.top + b.height / 2;
      const dx = Math.max(16, Math.abs(x2 - x1) / 2);
      next.push({
        id: dep.id,
        d: `M ${x1.toFixed(1)} ${y1.toFixed(1)} C ${(x1 + dx).toFixed(1)} ${y1.toFixed(1)}, ${(x2 - dx).toFixed(1)} ${y2.toFixed(1)}, ${x2.toFixed(1)} ${y2.toFixed(1)}`,
      });
    }
    setArrows(next);
  }, [data]);

  // Recompute after every layout change: data swap, container resize, font
  // load, window resize. rAF debounced so a drag-resize does not thrash.
  useEffect(() => {
    const root = contentRef.current;
    if (!root) return;
    let frame = 0;
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(recomputeArrows);
    };
    schedule();
    const ro = new ResizeObserver(schedule);
    ro.observe(root);
    window.addEventListener("resize", schedule);
    return () => {
      cancelAnimationFrame(frame);
      ro.disconnect();
      window.removeEventListener("resize", schedule);
    };
  }, [recomputeArrows]);

  // Navigation is pure scrolling — the server owns the window (it is the
  // sprint), so "‹ / ›" move the viewport by a week and "Heute" centres the
  // current column. No extra API contract needed.
  const scrollByDays = useCallback(
    (delta: number) => {
      scrollRef.current?.scrollBy({ left: delta * effectiveDayWidth, behavior: "smooth" });
    },
    [effectiveDayWidth]
  );

  const scrollToToday = useCallback(() => {
    const el = todayRef.current;
    const box = scrollRef.current;
    if (!el || !box) return;
    box.scrollTo({
      left: Math.max(0, el.offsetLeft - box.clientWidth / 2 + effectiveDayWidth / 2),
      behavior: "smooth",
    });
  }, [effectiveDayWidth]);

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
                      width: effectiveDayWidth,
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

          <div ref={contentRef} className="relative">
            <svg
              className="pointer-events-none absolute left-0 top-0 z-10"
              width={overlay.width || 1}
              height={overlay.height || 1}
              aria-hidden
            >
              <defs>
                <marker
                  id={markerId}
                  viewBox="0 0 8 8"
                  refX="7"
                  refY="4"
                  markerWidth="6"
                  markerHeight="6"
                  orient="auto-start-reverse"
                >
                  <path d="M 0 0 L 8 4 L 0 8 z" fill="var(--muted-foreground)" />
                </marker>
              </defs>
              {arrows.map((a) => (
                <path
                  key={a.id}
                  d={a.d}
                  fill="none"
                  stroke="var(--muted-foreground)"
                  strokeWidth={1.4}
                  strokeDasharray="4 3"
                  opacity={0.75}
                  markerEnd={`url(#${markerId})`}
                />
              ))}
            </svg>
            {rows.map((row) => (
              <div
                key={row.projectId ?? "__operativ__"}
                className="flex border-t border-border"
                style={{ height: row.height }}
              >
                {/* Zeilenlabel */}
                <div
                  style={{ width: ROW_LABEL_WIDTH }}
                  className="flex shrink-0 items-center gap-2 pr-3"
                >
                  <span
                    className="h-full w-[3px] shrink-0 rounded-full"
                    style={{ background: row.color }}
                  />
                  <div className="min-w-0">
                    <div className="truncate text-[12.5px] font-medium" style={{ color: "var(--foreground)" }}>
                      {row.projectName}
                    </div>
                    {(row.hidden > 0 || row.outside > 0) && (
                      <div
                        className="k-mono text-[10px]"
                        style={{ color: "var(--warn)" }}
                        title={[
                          row.hidden > 0
                            ? `${row.hidden} weitere Aufgaben werden aus Platzgründen nicht gezeichnet.`
                            : null,
                          row.outside > 0
                            ? `${row.outside} Aufgaben liegen ausserhalb des Zeitraums.`
                            : null,
                          'Im Projekt-Tab „Zeitleiste" siehst du alle.',
                        ]
                          .filter(Boolean)
                          .join(" ")}
                      >
                        {row.hidden > 0 && <>+{row.hidden} weitere</>}
                        {row.hidden > 0 && row.outside > 0 && " · "}
                        {row.outside > 0 && <>{row.outside} ausserhalb</>}
                      </div>
                    )}
                  </div>
                </div>

                {/* Balkenspur */}
                <div className="relative shrink-0" style={{ width: gridWidth }}>
                  {/* Spaltenraster als Hintergrund */}
                  <div className="pointer-events-none absolute inset-0 flex">
                    {days.map((d, i) => (
                      <div
                        key={i}
                        className="shrink-0"
                        style={{
                          width: effectiveDayWidth,
                          borderRight: "1px solid var(--border)",
                          background:
                            i === todayIndex
                              ? "color-mix(in oklch, var(--kottke-accent) 8%, transparent)"
                              : d.getDay() === 0 || d.getDay() === 6
                                ? "color-mix(in srgb, var(--muted) 55%, transparent)"
                                : "transparent",
                        }}
                      />
                    ))}
                  </div>

                  {row.visible.map((bar, i) => (
                    <TimelineBar
                      key={bar.taskId}
                      bar={bar}
                      lane={row.lanes[i]}
                      dayWidth={effectiveDayWidth}
                      selected={selectedTaskId === bar.taskId}
                      onClick={(id) => {
                        onSelectTask?.(selectedTaskId === id ? null : id);
                        onTaskClick?.(id);
                      }}
                      onDoubleClick={onBarDoubleClick}
                      registerRef={setBarRef}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-border pt-3">
        {(["geplant", "in_arbeit", "erledigt", "ueberfaellig"] as const).map((state) => (
          <span key={state} className="inline-flex items-center gap-1.5 text-[11.5px]" style={{ color: "var(--muted-foreground)" }}>
            <span
              className="h-[10px] w-[16px] shrink-0 rounded-[3px]"
              style={{
                background: `color-mix(in oklch, ${BAR_TOKEN[state]} 20%, transparent)`,
                border: `1px solid color-mix(in oklch, ${BAR_TOKEN[state]} 48%, transparent)`,
              }}
            />
            {BAR_LABEL[state]}
          </span>
        ))}
        <span className="inline-flex items-center gap-1.5 text-[11.5px]" style={{ color: "var(--muted-foreground)" }}>
          <svg width="20" height="8" aria-hidden>
            <path d="M 0 4 L 18 4" stroke="var(--muted-foreground)" strokeWidth={1.4} strokeDasharray="4 3" />
            <path d="M 14 1 L 20 4 L 14 7 z" fill="var(--muted-foreground)" />
          </svg>
          Abhängigkeit (Vorgänger → wartende Aufgabe)
        </span>
      </div>
    </div>
  );
}

function TimelineBar({
  bar,
  lane,
  dayWidth,
  selected = false,
  onClick,
  onDoubleClick,
  registerRef,
}: {
  bar: TimelineBarJSON;
  lane: number;
  dayWidth: number;
  selected?: boolean;
  onClick?: (taskId: string) => void;
  onDoubleClick?: (taskId: string) => void;
  registerRef: (taskId: string, el: HTMLElement | null) => void;
}) {
  const geo = timelineBarStyle(bar, dayWidth);
  const token = BAR_TOKEN[bar.state];
  const dl = deadlineLabel(bar.deadline, { done: bar.state === "erledigt" });
  const wide = geo.width >= 92;

  return (
    <button
      type="button"
      ref={(el) => registerRef(bar.taskId, el)}
      onClick={() => onClick?.(bar.taskId)}
      onDoubleClick={() => onDoubleClick?.(bar.taskId)}
      title={`${bar.title} · ${BAR_LABEL[bar.state]} · ${dl.text}`}
      className="absolute flex items-center gap-1.5 overflow-hidden px-2 text-left transition-transform hover:z-20 hover:scale-[1.02]"
      style={{
        left: geo.left,
        width: geo.width,
        top: ROW_PADDING + lane * (BAR_HEIGHT + LANE_GAP),
        height: BAR_HEIGHT,
        borderRadius: 7,
        background: `color-mix(in oklch, ${token} ${selected ? 34 : 20}%, transparent)`,
        border: selected
          ? "2px solid var(--foreground)"
          : `1px solid color-mix(in oklch, ${token} 48%, transparent)`,
        color: token,
        // Completed bars step back so the open work reads first.
        opacity: bar.state === "erledigt" ? 0.72 : 1,
      }}
    >
      {bar.state === "ueberfaellig" && <AlertTriangle className="h-[12px] w-[12px] shrink-0" />}
      <span
        className="min-w-0 flex-1 truncate text-[11.5px] font-medium"
        style={{
          color: "var(--foreground)",
          textDecoration: bar.state === "erledigt" ? "line-through" : undefined,
        }}
      >
        {bar.title}
      </span>
      {wide && bar.assignees.length > 0 && (
        <AvatarStack
          className="shrink-0"
          people={bar.assignees.map((a) => ({ id: a.userId, name: a.name, image: a.image }))}
          max={2}
        />
      )}
    </button>
  );
}
