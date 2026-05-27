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
  /** Effective points scored that day (subtask-aware). */
  points: number;
  /** Raw count of completed leaf tasks. Kept for tooltips / streak signal. */
  count: number;
}
interface UserPulse {
  userId: string;
  name: string;
  email: string;
  image: string | null;
  /** Total Fibonacci points scored this/last week from leaf tasks. */
  pointsThisWeek: number;
  pointsLastWeek: number;
  /** Raw task counts (kept as a secondary stat in the UI). */
  thisWeek: number;
  lastWeek: number;
  currentStreak: number;
  bestStreak: number;
  badges: string[];
  /** Tier bucket derived from lifetime points. */
  tier: TierName;
  tierProgress: { current: number; target: number };
  /** 28 entries oldest→newest */
  heatmap: HeatmapDay[];
  lifetimePoints: number;
  lifetimeCompleted: number;
}

type TierName = "Starter" | "Bronze" | "Silver" | "Gold" | "Platin";
const TIER_THRESHOLDS: { name: TierName; min: number }[] = [
  { name: "Starter", min: 0 },
  { name: "Bronze", min: 100 },
  { name: "Silver", min: 500 },
  { name: "Gold", min: 1500 },
  { name: "Platin", min: 5000 },
];

interface RecentWin {
  taskId: string;
  content: string;
  completedAt: string;
  assignees: { id: string; name: string }[];
}

interface PulseResponse {
  users: UserPulse[];
  /** Sum across all members. */
  pointsThisWeekTotal: number;
  pointsLastWeekTotal: number;
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
      pointsThisWeekTotal: 0,
      pointsLastWeekTotal: 0,
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
      pointEstimate: tasks.pointEstimate,
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

  // 2b) Find which tasks in this workspace have children — parents are
  // excluded from scoring (subtask-aware: only leaf completions score).
  // We check all tasks in the workspace, not just completed ones, so a
  // parent whose only subtasks are still open also yields 0 on its own
  // completion (which shouldn't really happen, but be defensive).
  const parentRows = await db
    .selectDistinct({ parentTaskId: tasks.parentTaskId })
    .from(tasks)
    .where(
      and(eq(tasks.workspaceId, ctx.workspaceId), isNotNull(tasks.parentTaskId))
    );
  const taskIdsWithChildren = new Set<string>();
  for (const r of parentRows) {
    if (r.parentTaskId) taskIdsWithChildren.add(r.parentTaskId);
  }

  // 3) Group by user → date for heatmap + streak math.
  //    `count` = leaf tasks done that day (binary "active day" signal).
  //    `points` = effective Fibonacci points (subtask-aware).
  type DayBucket = { count: number; points: number };
  const byUserDate = new Map<string, Map<string, DayBucket>>();
  for (const r of completedRows) {
    if (!r.completedAt) continue;
    // Parent tasks (with subtasks) don't score — only their leaves do.
    if (taskIdsWithChildren.has(r.taskId)) continue;
    const pts = r.pointEstimate ?? 1;
    const key = toISODate(r.completedAt);
    const m = byUserDate.get(r.userId) ?? new Map<string, DayBucket>();
    const bucket = m.get(key) ?? { count: 0, points: 0 };
    bucket.count += 1;
    bucket.points += pts;
    m.set(key, bucket);
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
    const dateBuckets =
      byUserDate.get(m.userId) ?? new Map<string, { count: number; points: number }>();

    const heatmap: HeatmapDay[] = heatmapDays.map((date) => {
      const b = dateBuckets.get(date);
      return { date, count: b?.count ?? 0, points: b?.points ?? 0 };
    });

    // Week deltas (both raw count and points)
    let thisWeek = 0;
    let lastWeek = 0;
    let pointsThisWeek = 0;
    let pointsLastWeek = 0;
    for (const [dateStr, bucket] of dateBuckets) {
      const d = new Date(dateStr);
      if (d >= thisWeekStart) {
        thisWeek += bucket.count;
        pointsThisWeek += bucket.points;
      } else if (d >= lastWeekStart) {
        lastWeek += bucket.count;
        pointsLastWeek += bucket.points;
      }
    }

    // Streaks operate on the binary "did anything today" signal so a
    // 1-point task still keeps the flame burning.
    const dateCounts = new Map<string, number>();
    for (const [k, v] of dateBuckets) dateCounts.set(k, v.count);
    const currentStreak = computeCurrentStreak(dateCounts, today);
    const bestStreak = computeBestStreak(dateCounts);

    let lifetimeCompleted = 0;
    let lifetimePoints = 0;
    for (const b of dateBuckets.values()) {
      lifetimeCompleted += b.count;
      lifetimePoints += b.points;
    }

    const { tier, tierProgress } = computeTier(lifetimePoints);

    const badges = deriveBadges({
      lifetimePoints,
      currentStreak,
      bestStreak,
      tier,
    });

    return {
      userId: m.userId,
      name: m.name,
      email: m.email,
      image: m.image,
      pointsThisWeek,
      pointsLastWeek,
      thisWeek,
      lastWeek,
      currentStreak,
      bestStreak,
      badges,
      tier,
      tierProgress,
      heatmap,
      lifetimePoints,
      lifetimeCompleted,
    };
  });

  // 6) Team totals
  let thisWeekTotal = 0;
  let lastWeekTotal = 0;
  let pointsThisWeekTotal = 0;
  let pointsLastWeekTotal = 0;
  for (const u of userPulses) {
    thisWeekTotal += u.thisWeek;
    lastWeekTotal += u.lastWeek;
    pointsThisWeekTotal += u.pointsThisWeek;
    pointsLastWeekTotal += u.pointsLastWeek;
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
    users: userPulses.sort((a, b) => b.pointsThisWeek - a.pointsThisWeek),
    pointsThisWeekTotal,
    pointsLastWeekTotal,
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

/**
 * Resolve lifetime points to a tier name + progress info for the bar.
 * Returns the next-tier target; when the user is already at the top tier
 * we keep the bar full and target=current.
 */
function computeTier(lifetimePoints: number): {
  tier: TierName;
  tierProgress: { current: number; target: number };
} {
  let current: TierName = "Starter";
  let nextTarget = TIER_THRESHOLDS[TIER_THRESHOLDS.length - 1]!.min;
  for (let i = 0; i < TIER_THRESHOLDS.length; i++) {
    const t = TIER_THRESHOLDS[i]!;
    if (lifetimePoints >= t.min) current = t.name;
  }
  for (const t of TIER_THRESHOLDS) {
    if (t.min > lifetimePoints) {
      nextTarget = t.min;
      break;
    }
  }
  return {
    tier: current,
    tierProgress: { current: lifetimePoints, target: nextTarget },
  };
}

function deriveBadges(input: {
  lifetimePoints: number;
  currentStreak: number;
  bestStreak: number;
  tier: TierName;
}): string[] {
  const out: string[] = [];
  // Tier badge competence signal — one of: Bronze / Silver / Gold / Platin.
  // Starter is implicit (no badge needed).
  if (input.tier !== "Starter") out.push(input.tier);
  if (input.currentStreak >= 30) out.push("30-Tage-Streak");
  else if (input.currentStreak >= 14) out.push("2-Wochen-Streak");
  else if (input.currentStreak >= 7) out.push("Wochen-Streak");
  if (input.bestStreak >= 60 && input.currentStreak < input.bestStreak) {
    out.push(`Best: ${input.bestStreak} Tage`);
  }
  return out;
}
