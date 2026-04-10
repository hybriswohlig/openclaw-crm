"use client";

import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
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

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

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
  if (!val) return null;
  if (typeof val === "string") return val.slice(0, 10);
  return null;
}

export default function ContractCalendarPage() {
  const [deals, setDeals] = useState<DealRecord[]>([]);
  const [stages, setStages] = useState<StageInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentDate, setCurrentDate] = useState(() => new Date());

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
          const data = await recRes.json();
          setDeals(data.data || []);
        }
        if (objRes.ok) {
          const objData = await objRes.json();
          const stageAttr = objData.data?.attributes?.find(
            (a: any) => a.slug === "stage" && a.type === "status"
          );
          if (stageAttr?.statuses) {
            setStages(stageAttr.statuses);
          }
        }
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const monthDays = useMemo(() => getMonthDays(year, month), [year, month]);

  const dealsByDate = useMemo(() => {
    const map = new Map<string, DealRecord[]>();
    for (const deal of deals) {
      const moveDate = parseDateValue(deal.values.move_date);
      if (!moveDate) continue;
      const existing = map.get(moveDate) || [];
      existing.push(deal);
      map.set(moveDate, existing);
    }
    return map;
  }, [deals]);

  function getStageInfo(stageId: unknown): StageInfo | undefined {
    if (!stageId) return undefined;
    return stages.find((s) => s.id === stageId);
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

  const monthLabel = new Date(year, month).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
  });

  const today = dateKey(new Date());

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
        <h1 className="text-2xl font-semibold">Contract Calendar</h1>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={goToday}>
            Today
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

      {/* Stage legend */}
      {stages.length > 0 && (
        <div className="flex flex-wrap gap-3 mb-4">
          {stages.map((s) => (
            <div key={s.id} className="flex items-center gap-1.5 text-xs">
              <div className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: s.color }} />
              <span className="text-muted-foreground">{s.title}</span>
            </div>
          ))}
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
                    const name = (deal.values.name as string) || "Untitled";
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
                      +{dayDeals.length - 3} more
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
