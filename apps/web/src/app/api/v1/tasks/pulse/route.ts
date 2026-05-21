// GET /api/v1/tasks/pulse
//
// Powers the "Team Pulse" gamification bar above the Kanban. Pure aggregation
// over the existing tasks + task_assignees tables — no schema changes.
//
// Returns per workspace member:
//   - heatmap: 28-day array of { date, count } (assignee's completed tasks)
//   - thisWeek / lastWeek counts (Mon–Sun rolling)
//   - currentStreak (consecutive trailing days with ≥1 completion)
//   - bestStreak (lifetime, capped at last 365 days for cost)
//   - badges: small string list of earned achievements
//
// Plus team-level:
//   - thisWeekTotal / lastWeekTotal
//   - recentWins: 5 most-recently-completed tasks with assignees
import { NextRequest } from "next/server";
import { and, desc, eq, gte, inArray, isNotNull, sql } from "drizzle-orm";
import { getAuthContext, unauthorized, success } from "@/lib/api-utils";
import { db } from "@/db";
import { tasks, taskAssignees } from "@/db/schema/tasks";
import { users } from "@/db/schema/auth";
import { workspaceMembers } from "@/db/schema/workspace";

export const dynamic = "force-dynamic";

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
  /** 28 entries oldest→newest */
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

export async function GET(req: NextRequest) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();

  // 1) Workspace members + their user rows
  const members = await db
    .select({
      userId: users.id,
      name: users.name,
      email: users.email,
      image: users.image,
    })
    .from(workspaceMembers)
    .innerJoin(users, eq(users.id, workspaceMembers.userId))
    .where(eq(workspaceMembers.workspaceId, ctx.workspaceId));

  if (members.length === 0) {
    return success<PulseResponse>({
      users: [],
      thisWeekTotal: 0,
      lastWeekTotal: 0,
      recentWins: [],
      generatedAt: new Date().toISOString(),
    });
  }
  const memberIds = members.map((m) => m.userId);

  // 2) Pull completed task rows tagged with assignees over the relevant window.
  // We cap lifetime queries at 365 days to keep this cheap. Streaks longer
  // than a year are capped at 365 (still impressive, costs us nothing).
  const since365 = new Date();
  since365.setDate(since365.getDate() - 365);

  const completedRows = await db
    .select({
      userId: taskAssignees.userId,
      completedAt: tasks.completedAt,
      taskId: tasks.id,
    })
    .from(tasks)
    .innerJoin(taskAssignees, eq(taskAssignees.taskId, tasks.id))
    .where(
      and(
        eq(tasks.workspaceId, ctx.workspaceId),
        eq(tasks.isCompleted, true),
        isNotNull(tasks.completedAt),
        gte(tasks.completedAt, since365),
        inArray(taskAssignees.userId, memberIds)
      )
    );

  // 3) Group by user → date for heatmap + streak math
  const byUserDate = new Map<string, Map<string, number>>(); // userId → date(YYYY-MM-DD) → count
  for (const r of completedRows) {
    if (!r.completedAt) continue;
    const key = toISODate(r.completedAt);
    const m = byUserDate.get(r.userId) ?? new Map<string, number>();
    m.set(key, (m.get(key) ?? 0) + 1);
    byUserDate.set(r.userId, m);
  }

  // 4) Date ranges
  const today = startOfDay(new Date());
  const heatmapDays: string[] = [];
  for (let i = 27; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    heatmapDays.push(toISODate(d));
  }

  // ISO week boundaries (Mon–Sun)
  const thisWeekStart = startOfWeekMonday(today);
  const lastWeekStart = new Date(thisWeekStart);
  lastWeekStart.setDate(thisWeekStart.getDate() - 7);

  // 5) Build per-user pulse
  const userPulses: UserPulse[] = members.map((m) => {
    const dateCounts = byUserDate.get(m.userId) ?? new Map<string, number>();

    const heatmap: HeatmapDay[] = heatmapDays.map((date) => ({
      date,
      count: dateCounts.get(date) ?? 0,
    }));

    // Week deltas
    let thisWeek = 0;
    let lastWeek = 0;
    for (const [dateStr, count] of dateCounts) {
      const d = new Date(dateStr);
      if (d >= thisWeekStart) thisWeek += count;
      else if (d >= lastWeekStart) lastWeek += count;
    }

    // Current streak: walk back from today, stop at first zero day.
    // Special case: if today is 0 but yesterday >0, streak still counts
    // yesterday's chain (don't punish someone before EOD).
    const currentStreak = computeCurrentStreak(dateCounts, today);
    const bestStreak = computeBestStreak(dateCounts);

    const lifetimeCompleted = sumValues(dateCounts);

    const badges = deriveBadges({
      lifetimeCompleted,
      currentStreak,
      bestStreak,
    });

    return {
      userId: m.userId,
      name: m.name,
      email: m.email,
      image: m.image,
      thisWeek,
      lastWeek,
      currentStreak,
      bestStreak,
      badges,
      heatmap,
      lifetimeCompleted,
    };
  });

  // 6) Team totals
  let thisWeekTotal = 0;
  let lastWeekTotal = 0;
  for (const u of userPulses) {
    thisWeekTotal += u.thisWeek;
    lastWeekTotal += u.lastWeek;
  }

  // 7) Recent wins — last 5 completions, joined to assignee names
  const recentTaskRows = await db
    .select({
      taskId: tasks.id,
      content: tasks.content,
      completedAt: tasks.completedAt,
    })
    .from(tasks)
    .where(
      and(
        eq(tasks.workspaceId, ctx.workspaceId),
        eq(tasks.isCompleted, true),
        isNotNull(tasks.completedAt)
      )
    )
    .orderBy(desc(tasks.completedAt))
    .limit(5);

  let recentWins: RecentWin[] = [];
  if (recentTaskRows.length > 0) {
    const taskIds = recentTaskRows.map((r) => r.taskId);
    const aRows = await db
      .select({
        taskId: taskAssignees.taskId,
        userId: users.id,
        userName: users.name,
      })
      .from(taskAssignees)
      .innerJoin(users, eq(users.id, taskAssignees.userId))
      .where(inArray(taskAssignees.taskId, taskIds));
    const byTask = new Map<string, { id: string; name: string }[]>();
    for (const r of aRows) {
      const arr = byTask.get(r.taskId) ?? [];
      arr.push({ id: r.userId, name: r.userName });
      byTask.set(r.taskId, arr);
    }
    recentWins = recentTaskRows.map((r) => ({
      taskId: r.taskId,
      content: r.content,
      completedAt: (r.completedAt as Date).toISOString(),
      assignees: byTask.get(r.taskId) ?? [],
    }));
  }

  // `sql` import kept for future filtering pushdowns; mark as used.
  void sql;

  return success<PulseResponse>({
    users: userPulses.sort((a, b) => b.thisWeek - a.thisWeek),
    thisWeekTotal,
    lastWeekTotal,
    recentWins,
    generatedAt: new Date().toISOString(),
  });
}

// ─── helpers ─────────────────────────────────────────────────────────────

function startOfDay(d: Date): Date {
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  return out;
}

function startOfWeekMonday(d: Date): Date {
  const out = startOfDay(d);
  const day = out.getDay(); // 0=Sun, 1=Mon … 6=Sat
  const diff = (day + 6) % 7; // distance back to Monday
  out.setDate(out.getDate() - diff);
  return out;
}

function toISODate(d: Date | string): string {
  const dd = d instanceof Date ? d : new Date(d);
  // YYYY-MM-DD in local time (so days line up with the local Kanban view)
  const y = dd.getFullYear();
  const m = String(dd.getMonth() + 1).padStart(2, "0");
  const day = String(dd.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function sumValues(m: Map<string, number>): number {
  let s = 0;
  for (const v of m.values()) s += v;
  return s;
}

/**
 * Walk back from today. If today has 0 completions, still count yesterday's
 * streak (don't kill someone's streak mid-day). Stop at the first day before
 * the current "ongoing" stretch.
 */
function computeCurrentStreak(
  counts: Map<string, number>,
  today: Date
): number {
  if (counts.size === 0) return 0;
  let streak = 0;
  const cursor = new Date(today);
  const todayKey = toISODate(cursor);
  const todayCount = counts.get(todayKey) ?? 0;
  if (todayCount === 0) {
    // Look at yesterday — if also 0, streak is 0.
    cursor.setDate(cursor.getDate() - 1);
    const yKey = toISODate(cursor);
    if ((counts.get(yKey) ?? 0) === 0) return 0;
  }
  // From here walk back while count > 0.
  for (let i = 0; i < 365; i++) {
    const key = toISODate(cursor);
    if ((counts.get(key) ?? 0) > 0) {
      streak++;
      cursor.setDate(cursor.getDate() - 1);
    } else {
      break;
    }
  }
  return streak;
}

function computeBestStreak(counts: Map<string, number>): number {
  if (counts.size === 0) return 0;
  const sortedDates = Array.from(counts.keys()).sort();
  let best = 0;
  let current = 0;
  let prev: Date | null = null;
  for (const ds of sortedDates) {
    const d = new Date(ds);
    if (prev) {
      const diffDays = Math.round((d.getTime() - prev.getTime()) / (1000 * 60 * 60 * 24));
      if (diffDays === 1) {
        current += 1;
      } else {
        current = 1;
      }
    } else {
      current = 1;
    }
    if (current > best) best = current;
    prev = d;
  }
  return best;
}

function deriveBadges(input: {
  lifetimeCompleted: number;
  currentStreak: number;
  bestStreak: number;
}): string[] {
  const out: string[] = [];
  if (input.lifetimeCompleted >= 1000) out.push("1000-Tasks-Club");
  else if (input.lifetimeCompleted >= 500) out.push("500-Tasks");
  else if (input.lifetimeCompleted >= 100) out.push("Erste 100 Tasks");
  if (input.currentStreak >= 30) out.push("30-Tage-Streak");
  else if (input.currentStreak >= 14) out.push("2-Wochen-Streak");
  else if (input.currentStreak >= 7) out.push("Wochen-Streak");
  if (input.bestStreak >= 60 && input.currentStreak < input.bestStreak) {
    out.push(`Best: ${input.bestStreak} Tage`);
  }
  return out;
}
