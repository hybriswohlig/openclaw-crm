"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, Loader2, X } from "lucide-react";
import { cn } from "@/lib/utils";

interface DealRecord {
  id: string;
  values: Record<string, unknown>;
}

interface StageInfo {
  id: string;
  title: string;
  color: string;
  isActive: boolean;
}

const WEEKDAYS = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];

/** Sentinel for deals without a stage value. */
const NO_STAGE_ID = "__no_stage__";

function getMonthDays(year: number, month: number) {
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);

  let startOffset = firstDay.getDay() - 1;
  if (startOffset < 0) startOffset = 6;

  const days: Array<{ date: Date; isCurrentMonth: boolean }> = [];

  for (let i = startOffset - 1; i >= 0; i--) {
    const d = new Date(year, month, -i);
    days.push({ date: d, isCurrentMonth: false });
  }

  for (let i = 1; i <= lastDay.getDate(); i++) {
    days.push({ date: new Date(year, month, i), isCurrentMonth: true });
  }

  while (days.length % 7 !== 0) {
    const nextDay = new Date(year, month + 1, days.length - lastDay.getDate() - startOffset + 1);
    days.push({ date: nextDay, isCurrentMonth: false });
  }

  return days;
}

function dateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function parseDateValue(val: unknown): string | null {
  if (val == null) return null;
  if (typeof val === "string") return val.slice(0, 10);
  if (val instanceof Date && !Number.isNaN(val.getTime())) {
    return dateKey(val);
  }
  return null;
}

function normalizeRecordsPayload(data: unknown): DealRecord[] {
  if (!data || typeof data !== "object") return [];
  const d = data as { records?: unknown };
  if (Array.isArray(d.records)) return d.records as DealRecord[];
  if (Array.isArray(data)) return data as DealRecord[];
  return [];
}

function dealStageKey(deal: DealRecord): string {
  const stage = deal.values.stage;
  if (stage == null || stage === "") return NO_STAGE_ID;
  return String(stage);
}

export default function ContractCalendarPage() {
  const [deals, setDeals] = useState<DealRecord[]>([]);
  const [stages, setStages] = useState<StageInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentDate, setCurrentDate] = useState(() => new Date());
  /** Empty set = show all stages. Otherwise only matching stage ids. */
  const [selectedStageIds, setSelectedStageIds] = useState<Set<string>>(() => new Set());

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const [recRes, objRes] = await Promise.all([
          fetch("/api/v1/objects/deals/records?limit=500"),
          fetch("/api/v1/objects/deals"),
        ]);
        if (recRes.ok) {
          const json = await recRes.json();
          setDeals(normalizeRecordsPayload(json.data));
        }
        if (objRes.ok) {
          const objData = await objRes.json();
          const attrs = objData.data?.attributes;
          const list = Array.isArray(attrs) ? attrs : [];
          const stageAttr = list.find(
            (a: { slug?: string; type?: string }) => a.slug === "stage" && a.type === "status"
          );
          const statuses = stageAttr?.statuses;
          setStages(Array.isArray(statuses) ? statuses : []);
        }
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const monthDays = useMemo(() => getMonthDays(year, month), [year, month]);

  const hasNoStageDeals = useMemo(() => {
    return deals.some((d) => parseDateValue(d.values.move_date) && dealStageKey(d) === NO_STAGE_ID);
  }, [deals]);

  const dealsByDate = useMemo(() => {
    const map = new Map<string, DealRecord[]>();
    const list = Array.isArray(deals) ? deals : [];
    const filterActive = selectedStageIds.size > 0;

    for (const deal of list) {
      const moveDate = parseDateValue(deal.values.move_date);
      if (!moveDate) continue;

      if (filterActive && !selectedStageIds.has(dealStageKey(deal))) {
        continue;
      }

      const existing = map.get(moveDate) || [];
      existing.push(deal);
      map.set(moveDate, existing);
    }
    return map;
  }, [deals, selectedStageIds]);

  const filteredCount = useMemo(() => {
    let n = 0;
    for (const list of dealsByDate.values()) n += list.length;
    return n;
  }, [dealsByDate]);

  const getStageInfo = useCallback(
    (stageId: unknown): StageInfo | undefined => {
      if (!stageId) return undefined;
      return stages.find((s) => s.id === stageId);
    },
    [stages]
  );

  function toggleStageFilter(stageId: string) {
    setSelectedStageIds((prev) => {
      const next = new Set(prev);
      if (next.has(stageId)) next.delete(stageId);
      else next.add(stageId);
      return next;
    });
  }

  function clearStageFilter() {
    setSelectedStageIds(new Set());
  }

  function prevMonth() {
    setCurrentDate(new Date(year, month - 1, 1));
  }

  function nextMonth() {
    setCurrentDate(new Date(year, month + 1, 1));
  }

  function goToday() {
    setCurrentDate(new Date());
  }

  const monthLabel = new Date(year, month).toLocaleDateString("de-DE", {
    month: "long",
    year: "numeric",
  });

  const today = dateKey(new Date());
  const filterActive = selectedStageIds.size > 0;

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="p-6 h-full flex flex-col">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-semibold">Kalender</h1>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={goToday}>
            Heute
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={prevMonth}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-sm font-medium w-40 text-center">{monthLabel}</span>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={nextMonth}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Status filter chips (also serve as legend) */}
      {stages.length > 0 && (
        <div className="mb-4 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-muted-foreground mr-1">Status:</span>
            <button
              type="button"
              onClick={clearStageFilter}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors",
                !filterActive
                  ? "border-foreground/30 bg-foreground text-background"
                  : "border-border bg-background text-muted-foreground hover:bg-muted"
              )}
            >
              Alle
            </button>
            {stages.map((s) => {
              const selected = selectedStageIds.has(s.id);
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => toggleStageFilter(s.id)}
                  aria-pressed={selected}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors",
                    selected
                      ? "border-transparent shadow-sm"
                      : "border-border bg-background text-muted-foreground hover:bg-muted opacity-80"
                  )}
                  style={
                    selected
                      ? {
                          backgroundColor: `${s.color}28`,
                          borderColor: s.color,
                          color: "inherit",
                        }
                      : undefined
                  }
                >
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: s.color }}
                  />
                  {s.title}
                </button>
              );
            })}
            {hasNoStageDeals && (
              <button
                type="button"
                onClick={() => toggleStageFilter(NO_STAGE_ID)}
                aria-pressed={selectedStageIds.has(NO_STAGE_ID)}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors",
                  selectedStageIds.has(NO_STAGE_ID)
                    ? "border-foreground/30 bg-muted text-foreground"
                    : "border-border bg-background text-muted-foreground hover:bg-muted opacity-80"
                )}
              >
                <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-muted-foreground/40" />
                Ohne Status
              </button>
            )}
            {filterActive && (
              <button
                type="button"
                onClick={clearStageFilter}
                className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              >
                <X className="h-3 w-3" />
                Filter zurücksetzen
              </button>
            )}
          </div>
          {filterActive && (
            <p className="text-xs text-muted-foreground">
              {filteredCount === 0
                ? "Keine Einträge für die gewählten Status"
                : `${filteredCount} Eintrag${filteredCount === 1 ? "" : "e"} mit gewähltem Status`}
            </p>
          )}
        </div>
      )}

      {/* Calendar grid */}
      <div className="flex-1 border border-border rounded-lg overflow-hidden">
        <div className="grid grid-cols-7 border-b border-border bg-muted/50">
          {WEEKDAYS.map((d) => (
            <div key={d} className="px-2 py-2 text-xs font-medium text-muted-foreground text-center">
              {d}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7 auto-rows-fr" style={{ minHeight: "calc(100% - 36px)" }}>
          {monthDays.map(({ date, isCurrentMonth }, i) => {
            const key = dateKey(date);
            const dayDeals = dealsByDate.get(key) || [];
            const isToday = key === today;

            return (
              <div
                key={i}
                className={cn(
                  "border-b border-r border-border p-1 min-h-[80px] overflow-hidden",
                  !isCurrentMonth && "bg-muted/30"
                )}
              >
                <div className="flex items-center justify-between mb-0.5">
                  <span
                    className={cn(
                      "text-xs font-medium w-6 h-6 flex items-center justify-center rounded-full",
                      isToday && "bg-foreground text-background",
                      !isCurrentMonth && "text-muted-foreground"
                    )}
                  >
                    {date.getDate()}
                  </span>
                  {dayDeals.length > 0 && (
                    <span className="text-[10px] text-muted-foreground">{dayDeals.length}</span>
                  )}
                </div>
                <div className="space-y-0.5">
                  {dayDeals.slice(0, 3).map((deal) => {
                    const stage = getStageInfo(deal.values.stage);
                    const name = (deal.values.name as string) || "Ohne Titel";
                    return (
                      <Link
                        key={deal.id}
                        href={`/objects/deals/${deal.id}`}
                        className="block rounded px-1 py-0.5 text-[11px] leading-tight truncate hover:opacity-80 transition-opacity"
                        style={{
                          backgroundColor: stage ? `${stage.color}20` : undefined,
                          borderLeft: `2px solid ${stage?.color || "#888"}`,
                        }}
                      >
                        {name}
                      </Link>
                    );
                  })}
                  {dayDeals.length > 3 && (
                    <span className="text-[10px] text-muted-foreground pl-1">
                      +{dayDeals.length - 3} weitere
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
