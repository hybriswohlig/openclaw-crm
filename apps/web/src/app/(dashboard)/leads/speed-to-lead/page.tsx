"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { RefreshCw, Layers, AlertTriangle, Inbox } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  isBerlinBusinessHour,
  minutesSince,
  formatBerlinDateTime,
  formatRelative,
} from "@/lib/business-hours";

interface SpeedRow {
  id: string;
  name: string;
  leadSubsource: string | null;
  leadReceivedAt: string | null;
  createdAt: string;
}

const SLA_BREACH_MINUTES = 30;

export default function SpeedToLeadPage() {
  const [rows, setRows] = useState<SpeedRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [groupBySubsource, setGroupBySubsource] = useState(false);
  const [now, setNow] = useState<Date>(() => new Date());

  const fetchRows = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/v1/deals/speed-to-lead", { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        setRows(data.data?.records ?? []);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRows();
  }, [fetchRows]);

  // Re-evaluate "now" once a minute so SLA badges update without a refresh.
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);

  const inBusinessHours = isBerlinBusinessHour(now);

  const groups = useMemo(() => {
    if (!groupBySubsource) return [{ key: "all", label: null, rows }];
    const map = new Map<string, SpeedRow[]>();
    for (const r of rows) {
      const k = r.leadSubsource && r.leadSubsource.length > 0 ? r.leadSubsource : "(untagged)";
      const arr = map.get(k) ?? [];
      arr.push(r);
      map.set(k, arr);
    }
    return [...map.entries()]
      .sort((a, b) => (a[0] === "(untagged)" ? 1 : b[0] === "(untagged)" ? -1 : a[0].localeCompare(b[0])))
      .map(([label, rs]) => ({ key: label, label, rows: rs }));
  }, [rows, groupBySubsource]);

  const breachedCount = useMemo(() => {
    if (!inBusinessHours) return 0;
    return rows.filter((r) => {
      if (!r.leadReceivedAt) return false;
      const elapsed = minutesSince(new Date(r.leadReceivedAt), now);
      return elapsed > SLA_BREACH_MINUTES;
    }).length;
  }, [rows, now, inBusinessHours]);

  return (
    <div className="flex h-full flex-col">
      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 border-b border-border px-3 sm:px-4 py-2">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-semibold">Unanswered Kleinanzeigen leads</h1>
          <span className="text-sm text-muted-foreground">
            {rows.length} {rows.length === 1 ? "lead" : "leads"}
          </span>
          {inBusinessHours && breachedCount > 0 && (
            <Badge variant="destructive" className="gap-1">
              <AlertTriangle className="h-3 w-3" />
              {breachedCount} over 30 min
            </Badge>
          )}
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            className={cn("text-xs gap-1", groupBySubsource && "text-primary")}
            onClick={() => setGroupBySubsource((v) => !v)}
          >
            <Layers className="h-3.5 w-3.5" />
            Group by variant
          </Button>
          <Button variant="ghost" size="icon" onClick={fetchRows} disabled={loading}>
            <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
          </Button>
        </div>
      </div>

      {/* Subtitle */}
      <div className="border-b border-border/50 px-4 py-1.5 text-xs text-muted-foreground">
        Deals stuck in <span className="font-medium">Inquiry</span> with no first response.
        SLA: response within 30 min of receipt during business hours
        (Mo–Sa 08:00–20:00 Europe/Berlin)
        {!inBusinessHours && (
          <span className="ml-2 italic">
            — currently outside business hours, badges paused.
          </span>
        )}
      </div>

      {/* Body */}
      <div className="flex-1 overflow-auto">
        {loading && rows.length === 0 ? (
          <div className="flex h-full items-center justify-center text-muted-foreground">
            Loading…
          </div>
        ) : rows.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
            <Inbox className="h-8 w-8" />
            <div className="text-sm">All Kleinanzeigen leads have been answered.</div>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {groups.map((g) => (
              <div key={g.key}>
                {g.label && (
                  <div className="sticky top-0 z-10 flex items-center gap-2 bg-muted/40 px-4 py-1 text-xs font-medium text-muted-foreground backdrop-blur">
                    <span className="truncate">{g.label}</span>
                    <span className="text-muted-foreground/70">
                      · {g.rows.length}
                    </span>
                  </div>
                )}
                <ul className="divide-y divide-border">
                  {g.rows.map((r) => {
                    const received = r.leadReceivedAt ? new Date(r.leadReceivedAt) : null;
                    const elapsed = received ? minutesSince(received, now) : null;
                    const breached =
                      inBusinessHours &&
                      elapsed !== null &&
                      elapsed > SLA_BREACH_MINUTES;
                    return (
                      <li key={r.id}>
                        <Link
                          href={`/objects/deals/${r.id}`}
                          className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted/40 transition-colors"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="truncate text-sm font-medium">
                                {r.name || "(no name)"}
                              </span>
                              {breached && (
                                <Badge
                                  variant="destructive"
                                  className="gap-1 shrink-0"
                                >
                                  <AlertTriangle className="h-3 w-3" />
                                  &gt; 30 min
                                </Badge>
                              )}
                            </div>
                            <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                              {r.leadSubsource ? (
                                <span className="truncate font-mono">
                                  {r.leadSubsource}
                                </span>
                              ) : (
                                <span className="italic">untagged variant</span>
                              )}
                            </div>
                          </div>
                          <div className="text-right text-xs shrink-0">
                            {received ? (
                              <>
                                <div className={cn(
                                  "font-medium",
                                  breached ? "text-destructive" : "text-foreground"
                                )}>
                                  {formatRelative(received, now)}
                                </div>
                                <div className="text-muted-foreground">
                                  {formatBerlinDateTime(received)}
                                </div>
                              </>
                            ) : (
                              <span className="italic text-muted-foreground">
                                no timestamp
                              </span>
                            )}
                          </div>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
