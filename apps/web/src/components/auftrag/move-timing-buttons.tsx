"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Play, MapPin, CheckCircle2, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";

interface TimingState {
  departureAt: string | null;
  onsiteAt: string | null;
  finishedAt: string | null;
}

type Milestone = "departure" | "onsite" | "finished";

/**
 * Three big buttons that the operator on-site (or in the office) taps as the
 * job moves through its phases. Each tap writes a timestamp to
 * `move_time_entries`; the customer portal picks up the change on its next
 * 30 s poll.
 *
 * A "Reset" affordance is exposed per milestone so an accidental tap can be
 * undone — backend accepts `{ clear: true }` to null out the column.
 */
export function MoveTimingButtons({ dealRecordId }: { dealRecordId: string }) {
  const [state, setState] = useState<TimingState | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<Milestone | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/v1/deals/${dealRecordId}/move-timing`);
      if (res.ok) {
        const json = (await res.json()) as { data: TimingState };
        setState(json.data);
      }
    } finally {
      setLoading(false);
    }
  }, [dealRecordId]);

  useEffect(() => {
    load();
  }, [load]);

  async function trigger(milestone: Milestone, clear = false) {
    setBusy(milestone);
    try {
      const res = await fetch(`/api/v1/deals/${dealRecordId}/move-timing`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ milestone, clear }),
      });
      if (res.ok) {
        const json = (await res.json()) as { data: TimingState };
        setState(json.data);
      }
    } finally {
      setBusy(null);
    }
  }

  if (loading) {
    return (
      <div className="flex h-10 items-center justify-center text-xs text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
      </div>
    );
  }

  const departure = state?.departureAt ?? null;
  const onsite = state?.onsiteAt ?? null;
  const finished = state?.finishedAt ?? null;

  return (
    <div className="space-y-2">
      <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
        Live-Status für Kunden-Portal
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <MilestoneButton
          icon={<Play className="h-4 w-4" />}
          title="Anfahrt gestartet"
          done={!!departure}
          busy={busy === "departure"}
          timestamp={departure}
          onClick={() => trigger("departure")}
          onReset={() => trigger("departure", true)}
        />
        <MilestoneButton
          icon={<MapPin className="h-4 w-4" />}
          title="Vor Ort"
          done={!!onsite}
          busy={busy === "onsite"}
          timestamp={onsite}
          onClick={() => trigger("onsite")}
          onReset={() => trigger("onsite", true)}
        />
        <MilestoneButton
          icon={<CheckCircle2 className="h-4 w-4" />}
          title="Auftrag beendet"
          done={!!finished}
          busy={busy === "finished"}
          timestamp={finished}
          onClick={() => trigger("finished")}
          onReset={() => trigger("finished", true)}
        />
      </div>
    </div>
  );
}

function MilestoneButton({
  icon,
  title,
  done,
  busy,
  timestamp,
  onClick,
  onReset,
}: {
  icon: React.ReactNode;
  title: string;
  done: boolean;
  busy: boolean;
  timestamp: string | null;
  onClick: () => void;
  onReset: () => void;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-1 rounded-xl border bg-card p-3 transition-colors",
        done ? "border-emerald-200 bg-emerald-50 dark:border-emerald-900/40 dark:bg-emerald-950/40" : "border-border"
      )}
    >
      <button
        type="button"
        onClick={onClick}
        disabled={busy || done}
        className={cn(
          "flex items-center gap-2 text-sm font-medium",
          done ? "text-emerald-900 dark:text-emerald-200" : "text-foreground"
        )}
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : icon}
        {title}
      </button>
      <div className="flex items-center justify-between text-[11px]">
        <span className="text-muted-foreground">
          {timestamp
            ? new Date(timestamp).toLocaleString("de-DE", {
                hour: "2-digit",
                minute: "2-digit",
                day: "2-digit",
                month: "2-digit",
              })
            : "noch nicht erreicht"}
        </span>
        {done && (
          <button
            type="button"
            onClick={onReset}
            disabled={busy}
            className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
            title="Zurücksetzen"
          >
            <RotateCcw className="h-3 w-3" />
            reset
          </button>
        )}
      </div>
    </div>
  );
}
