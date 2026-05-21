// apps/web/src/components/tasks/team-pulse-bar.tsx
//
// Gamification bar above the Kanban. Pure read-only — fetches
// /api/v1/tasks/pulse and renders per-user streak + 28-day heatmap, a
// team "this week" headline, and (when present) badge chips.
//
// Design notes:
//   - No leaderboard ranking. Members are sorted by thisWeek desc but no
//     position numbers shown.
//   - Heatmap uses 5 intensity buckets keyed off the *team's* max so
//     someone with 1 task in a low-activity week still lights up.
//   - Streak fires the flame icon at 3+ days, intensifies visually at 7/30.
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Flame, TrendingUp, TrendingDown, CheckCircle2, Trophy } from "lucide-react";

interface HeatmapDay {
  date: string;
  count: number;
}
interface UserPulse {
  userId: string;
  name: string;
  email: string;
  image: string | null;
  thisWeek: number;
  lastWeek: number;
  currentStreak: number;
  bestStreak: number;
  badges: string[];
  heatmap: HeatmapDay[];
  lifetimeCompleted: number;
}
interface RecentWin {
  taskId: string;
  content: string;
  completedAt: string;
  assignees: { id: string; name: string }[];
}
interface PulseResponse {
  users: UserPulse[];
  thisWeekTotal: number;
  lastWeekTotal: number;
  recentWins: RecentWin[];
  generatedAt: string;
}

export function TeamPulseBar() {
  const [data, setData] = useState<PulseResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showWins, setShowWins] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const resp = await fetch("/api/v1/tasks/pulse", { cache: "no-store" });
      if (!resp.ok) {
        setError(`HTTP ${resp.status}`);
        return;
      }
      const json = (await resp.json()) as { data?: PulseResponse };
      setData(json.data ?? null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    // Re-fetch when the tab regains focus so closed tasks reflect quickly.
    const onFocus = () => load();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [load]);

  // 5-bucket intensity scale based on the team's busiest single day across
  // the heatmap window. Falls back to a fixed scale when there are no
  // completions yet so the grid still looks correct.
  const maxDay = useMemo(() => {
    if (!data) return 0;
    let m = 0;
    for (const u of data.users) {
      for (const d of u.heatmap) if (d.count > m) m = d.count;
    }
    return m;
  }, [data]);

  if (loading && !data) {
    return (
      <div className="rounded-lg border border-border bg-muted/10 p-3 text-xs text-muted-foreground">
        Lade Team-Pulse…
      </div>
    );
  }
  if (error) {
    return (
      <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-2 text-xs text-red-700">
        Team-Pulse nicht erreichbar: {error}
      </div>
    );
  }
  if (!data || data.users.length === 0) {
    return null;
  }

  const weekDelta = data.thisWeekTotal - data.lastWeekTotal;

  return (
    <div className="space-y-2">
      <div className="rounded-lg border border-border bg-muted/10 p-3 sm:p-4">
        {/* ── Team headline ───────────────────────────────────────── */}
        <div className="flex flex-wrap items-center gap-3 mb-3 pb-3 border-b border-border">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
            <span className="text-2xl font-bold tabular-nums">{data.thisWeekTotal}</span>
            <span className="text-xs text-muted-foreground">Tasks diese Woche</span>
          </div>
          <DeltaBadge delta={weekDelta} compareLabel="vs Vorwoche" />
          <div className="ml-auto">
            <button
              type="button"
              onClick={() => setShowWins((v) => !v)}
              className="inline-flex items-center gap-1 rounded border bg-white px-2 py-1 text-xs hover:bg-gray-50 dark:bg-gray-900 dark:hover:bg-gray-800"
            >
              <Trophy className="h-3 w-3" />
              {showWins ? "Wins ausblenden" : "Letzte Wins"}
            </button>
          </div>
        </div>

        {/* ── Recent wins (toggleable) ────────────────────────────── */}
        {showWins && data.recentWins.length > 0 && (
          <ul className="mb-3 pb-3 border-b border-border space-y-1">
            {data.recentWins.map((w) => (
              <li key={w.taskId} className="flex items-center gap-2 text-xs">
                <CheckCircle2 className="h-3 w-3 text-emerald-600 shrink-0" />
                <span className="truncate flex-1">{w.content}</span>
                <span className="text-muted-foreground shrink-0">
                  {w.assignees.map((a) => a.name).join(", ")} ·{" "}
                  {formatRelative(w.completedAt)}
                </span>
              </li>
            ))}
          </ul>
        )}

        {/* ── Per-user rows ────────────────────────────────────────── */}
        <div className="space-y-3">
          {data.users.map((u) => (
            <UserRow key={u.userId} user={u} maxDay={maxDay} />
          ))}
        </div>
      </div>
    </div>
  );
}

function UserRow({ user, maxDay }: { user: UserPulse; maxDay: number }) {
  const delta = user.thisWeek - user.lastWeek;
  const streakActive = user.currentStreak >= 3;
  const streakHot = user.currentStreak >= 7;
  const streakFire = user.currentStreak >= 30;

  return (
    <div className="flex flex-wrap items-center gap-3">
      {/* Identity */}
      <div className="flex items-center gap-2 min-w-[140px]">
        <Avatar user={user} />
        <div className="leading-tight">
          <div className="text-sm font-medium truncate">{user.name}</div>
          <div className="text-[10px] text-muted-foreground tabular-nums">
            {user.lifetimeCompleted} lifetime
          </div>
        </div>
      </div>

      {/* Streak */}
      <div
        className={`flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium tabular-nums ${
          streakFire
            ? "bg-orange-200 text-orange-900"
            : streakHot
            ? "bg-orange-100 text-orange-800"
            : streakActive
            ? "bg-amber-100 text-amber-800"
            : "bg-muted text-muted-foreground"
        }`}
        title={user.bestStreak > 0 ? `Best: ${user.bestStreak} Tage` : undefined}
      >
        <Flame className={`h-3.5 w-3.5 ${streakActive ? "" : "opacity-40"}`} />
        {user.currentStreak} {user.currentStreak === 1 ? "Tag" : "Tage"}
      </div>

      {/* This-week count + delta */}
      <div className="flex items-center gap-1.5 text-xs">
        <span className="tabular-nums font-semibold">{user.thisWeek}</span>
        <span className="text-muted-foreground">diese Woche</span>
        {delta !== 0 && <DeltaBadge delta={delta} small />}
      </div>

      {/* Heatmap */}
      <div className="ml-auto" title="Letzte 28 Tage">
        <Heatmap days={user.heatmap} maxDay={maxDay} />
      </div>

      {/* Badges */}
      {user.badges.length > 0 && (
        <div className="flex flex-wrap gap-1 basis-full">
          {user.badges.map((b, i) => (
            <span
              key={i}
              className="inline-flex items-center gap-1 rounded-full bg-purple-100 text-purple-900 px-2 py-0.5 text-[10px] font-medium dark:bg-purple-900/30 dark:text-purple-200"
            >
              <Trophy className="h-3 w-3" /> {b}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function Heatmap({ days, maxDay }: { days: HeatmapDay[]; maxDay: number }) {
  // 28 days into 4 columns × 7 rows (oldest top-left, newest bottom-right
  // when read left-to-right top-to-bottom). Each row = one week.
  return (
    <div className="inline-grid grid-flow-col grid-rows-7 gap-[2px]">
      {days.map((d) => (
        <div
          key={d.date}
          title={`${d.date}: ${d.count}`}
          className={`h-2.5 w-2.5 rounded-[2px] ${intensityClass(d.count, maxDay)}`}
        />
      ))}
    </div>
  );
}

function intensityClass(count: number, maxDay: number): string {
  if (count === 0) return "bg-muted/50";
  const m = Math.max(maxDay, 1);
  const ratio = count / m;
  if (ratio >= 0.8) return "bg-emerald-700";
  if (ratio >= 0.5) return "bg-emerald-600";
  if (ratio >= 0.25) return "bg-emerald-500";
  return "bg-emerald-300";
}

function DeltaBadge({
  delta,
  small,
  compareLabel,
}: {
  delta: number;
  small?: boolean;
  compareLabel?: string;
}) {
  if (delta === 0 && !compareLabel) return null;
  const pos = delta > 0;
  const neg = delta < 0;
  const sizeCls = small ? "text-[10px] px-1.5 py-0" : "text-xs px-2 py-0.5";
  const color = pos
    ? "bg-emerald-100 text-emerald-800"
    : neg
    ? "bg-rose-100 text-rose-800"
    : "bg-muted text-muted-foreground";
  return (
    <span className={`inline-flex items-center gap-1 rounded ${sizeCls} ${color} tabular-nums`}>
      {pos && <TrendingUp className={small ? "h-2.5 w-2.5" : "h-3 w-3"} />}
      {neg && <TrendingDown className={small ? "h-2.5 w-2.5" : "h-3 w-3"} />}
      {pos ? "+" : ""}
      {delta}
      {compareLabel && <span className="opacity-80">· {compareLabel}</span>}
    </span>
  );
}

function Avatar({ user }: { user: UserPulse }) {
  if (user.image) {
    // eslint-disable-next-line @next/next/no-img-element
    return (
      <img
        src={user.image}
        alt={user.name}
        className="h-7 w-7 rounded-full object-cover border border-border"
      />
    );
  }
  const initials = user.name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase())
    .join("");
  return (
    <div className="h-7 w-7 rounded-full bg-muted flex items-center justify-center text-[10px] font-semibold text-muted-foreground border border-border">
      {initials || "?"}
    </div>
  );
}

function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.round(diff / 60000);
  if (min < 1) return "gerade eben";
  if (min < 60) return `vor ${min} min`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `vor ${hr} h`;
  const d = Math.round(hr / 24);
  if (d < 7) return `vor ${d} ${d === 1 ? "Tag" : "Tagen"}`;
  return new Date(iso).toLocaleDateString("de-DE");
}
