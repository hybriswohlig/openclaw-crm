/**
 * Workspace-wide KPI aggregates that power the /statistics dashboard.
 *
 * Designed to reuse the same EAV access patterns as operations.ts and
 * financial.ts: resolve the relevant object + attribute IDs once, then run
 * targeted recordValues queries scoped by workspace.
 */

import { db } from "@/db";
import { and, eq, gte, lt, inArray, sum, sql } from "drizzle-orm";
import { objects, attributes, statuses, selectOptions } from "@/db/schema/objects";
import { records, recordValues } from "@/db/schema/records";
import { payments, expenses, employeeTransactions } from "@/db/schema/financial";
import { tasks } from "@/db/schema/tasks";

// ─── Period helpers ──────────────────────────────────────────────────────────

export type Period = "30d" | "90d" | "365d" | "ytd";

export function periodRange(period: Period): { start: Date; end: Date } {
  const end = new Date();
  let start: Date;
  if (period === "ytd") {
    start = new Date(Date.UTC(end.getUTCFullYear(), 0, 1));
  } else {
    const days = period === "30d" ? 30 : period === "90d" ? 90 : 365;
    start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate() - days));
  }
  return { start, end };
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function startOfMonthUtc(year: number, month: number): Date {
  return new Date(Date.UTC(year, month, 1));
}

function startOfIsoWeek(d: Date): Date {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = date.getUTCDay(); // 0=Sun..6=Sat
  const diff = (day === 0 ? -6 : 1 - day);
  date.setUTCDate(date.getUTCDate() + diff);
  return date;
}

function isoWeekKey(d: Date): string {
  // YYYY-Www
  const week = startOfIsoWeek(d);
  // ISO week year handling — fine enough for KPI buckets
  const target = new Date(Date.UTC(week.getUTCFullYear(), week.getUTCMonth(), week.getUTCDate()));
  target.setUTCDate(target.getUTCDate() + 3); // Thursday in this week
  const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4));
  const weekNo = 1 + Math.round(((target.getTime() - firstThursday.getTime()) / 86400000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
  return `${target.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

// ─── Metadata loader: deals + auftraege attributes & lookups ────────────────

interface DealMeta {
  dealObjectId: string | null;
  attrBySlug: Map<string, { id: string; type: string }>;
  stageById: Map<string, { title: string; color: string; sortOrder: number; isActive: boolean }>;
  stageByLowerTitle: Map<string, string>; // title → id
}

async function loadDealMeta(workspaceId: string): Promise<DealMeta> {
  const [dealObj] = await db
    .select({ id: objects.id })
    .from(objects)
    .where(and(eq(objects.workspaceId, workspaceId), eq(objects.slug, "deals")))
    .limit(1);

  if (!dealObj) {
    return {
      dealObjectId: null,
      attrBySlug: new Map(),
      stageById: new Map(),
      stageByLowerTitle: new Map(),
    };
  }

  const attrs = await db
    .select({ id: attributes.id, slug: attributes.slug, type: attributes.type })
    .from(attributes)
    .where(eq(attributes.objectId, dealObj.id));
  const attrBySlug = new Map(attrs.map((a) => [a.slug, { id: a.id, type: a.type as string }]));

  const stageAttr = attrBySlug.get("stage");
  let stageById = new Map<string, { title: string; color: string; sortOrder: number; isActive: boolean }>();
  const stageByLowerTitle = new Map<string, string>();
  if (stageAttr) {
    const rows = await db.select().from(statuses).where(eq(statuses.attributeId, stageAttr.id));
    stageById = new Map(
      rows.map((s) => [s.id, { title: s.title, color: s.color, sortOrder: s.sortOrder, isActive: s.isActive }])
    );
    for (const s of rows) stageByLowerTitle.set(s.title.toLowerCase(), s.id);
  }

  return { dealObjectId: dealObj.id, attrBySlug, stageById, stageByLowerTitle };
}

// Bulk-load specific deal attribute values into a per-record map.
async function loadDealValues(dealIds: string[], attrIds: string[]) {
  if (dealIds.length === 0 || attrIds.length === 0) return new Map<string, Map<string, typeof recordValues.$inferSelect>>();
  const rows = await db
    .select()
    .from(recordValues)
    .where(and(inArray(recordValues.recordId, dealIds), inArray(recordValues.attributeId, attrIds)));
  const byRecord = new Map<string, Map<string, typeof rows[number]>>();
  for (const r of rows) {
    let m = byRecord.get(r.recordId);
    if (!m) {
      m = new Map();
      byRecord.set(r.recordId, m);
    }
    m.set(r.attributeId, r);
  }
  return byRecord;
}

// Resolve operating_company record IDs → display names.
async function loadOperatingCompanyNames(
  workspaceId: string,
  companyIds: string[]
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (companyIds.length === 0) return out;

  const [ocObj] = await db
    .select({ id: objects.id })
    .from(objects)
    .where(and(eq(objects.workspaceId, workspaceId), eq(objects.slug, "operating_companies")))
    .limit(1);
  if (!ocObj) return out;

  const [nameAttr] = await db
    .select({ id: attributes.id })
    .from(attributes)
    .where(and(eq(attributes.objectId, ocObj.id), eq(attributes.slug, "name")))
    .limit(1);
  if (!nameAttr) return out;

  const rows = await db
    .select({ recordId: recordValues.recordId, name: recordValues.textValue })
    .from(recordValues)
    .where(
      and(eq(recordValues.attributeId, nameAttr.id), inArray(recordValues.recordId, companyIds))
    );
  for (const r of rows) out.set(r.recordId, r.name ?? "Unbekannt");
  return out;
}

// ─── Overview ────────────────────────────────────────────────────────────────

export interface OverviewStats {
  revenueYtd: number;
  revenueMtd: number;
  revenueMtdDeltaPct: number | null;
  newLeads30d: number;
  winRate90dPct: number | null;
  outstandingAmount: number;
  movesThisWeek: number;
  revenueSeries8w: number[];
  newLeadsSeries8w: number[];
}

export async function getOverviewStats(workspaceId: string): Promise<OverviewStats> {
  const now = new Date();
  const year = now.getUTCFullYear();
  const monthStart = startOfMonthUtc(year, now.getUTCMonth());
  const yearStart = startOfMonthUtc(year, 0);
  const prevMonthStart = startOfMonthUtc(year, now.getUTCMonth() - 1);

  // Revenue (payments) YTD + MTD + prev-month
  const [ytdRow] = await db
    .select({ total: sum(payments.amount) })
    .from(payments)
    .where(and(eq(payments.workspaceId, workspaceId), gte(payments.date, isoDate(yearStart))));
  const [mtdRow] = await db
    .select({ total: sum(payments.amount) })
    .from(payments)
    .where(and(eq(payments.workspaceId, workspaceId), gte(payments.date, isoDate(monthStart))));
  const [prevMonthRow] = await db
    .select({ total: sum(payments.amount) })
    .from(payments)
    .where(
      and(
        eq(payments.workspaceId, workspaceId),
        gte(payments.date, isoDate(prevMonthStart)),
        lt(payments.date, isoDate(monthStart))
      )
    );
  const revenueYtd = Number(ytdRow?.total ?? 0);
  const revenueMtd = Number(mtdRow?.total ?? 0);
  const revenuePrevMonth = Number(prevMonthRow?.total ?? 0);
  const revenueMtdDeltaPct =
    revenuePrevMonth > 0
      ? Math.round(((revenueMtd - revenuePrevMonth) / revenuePrevMonth) * 100)
      : null;

  // 8-week revenue series (oldest → newest)
  const eightWeeksAgo = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 7 * 8));
  const weeklyRevenueRows = await db
    .select({
      week: sql<string>`to_char(date_trunc('week', ${payments.date}::date), 'YYYY-MM-DD')`,
      total: sum(payments.amount),
    })
    .from(payments)
    .where(and(eq(payments.workspaceId, workspaceId), gte(payments.date, isoDate(eightWeeksAgo))))
    .groupBy(sql`date_trunc('week', ${payments.date}::date)`);
  const revenueSeries8w = bucketBy8Weeks(weeklyRevenueRows.map((r) => ({ week: r.week, value: Number(r.total ?? 0) })), now);

  // Deal-side metrics
  const meta = await loadDealMeta(workspaceId);
  let newLeads30d = 0;
  let winRate90dPct: number | null = null;
  let outstandingAmount = 0;
  let movesThisWeek = 0;
  let newLeadsSeries8w: number[] = new Array(8).fill(0);

  if (meta.dealObjectId) {
    // New leads in last 30 days (record created)
    const thirtyAgo = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 30));
    const [{ cnt }] = await db
      .select({ cnt: sql<number>`count(*)::int` })
      .from(records)
      .where(and(eq(records.objectId, meta.dealObjectId), gte(records.createdAt, thirtyAgo)));
    newLeads30d = Number(cnt ?? 0);

    // 8-week new-leads series
    const eightWeekLeadRows = await db
      .select({
        week: sql<string>`to_char(date_trunc('week', ${records.createdAt}), 'YYYY-MM-DD')`,
        cnt: sql<number>`count(*)::int`,
      })
      .from(records)
      .where(and(eq(records.objectId, meta.dealObjectId), gte(records.createdAt, eightWeeksAgo)))
      .groupBy(sql`date_trunc('week', ${records.createdAt})`);
    newLeadsSeries8w = bucketBy8Weeks(
      eightWeekLeadRows.map((r) => ({ week: r.week, value: Number(r.cnt ?? 0) })),
      now
    );

    const stageAttr = meta.attrBySlug.get("stage");
    const valueAttr = meta.attrBySlug.get("value");
    const moveDateAttr = meta.attrBySlug.get("move_date");

    // Win-rate over deals whose stage is currently a terminal stage (Paid / Lost).
    // Approximation: use current stage rather than transition history.
    const paidStageId = meta.stageByLowerTitle.get("paid") ?? meta.stageByLowerTitle.get("bezahlt (abgeschlossen)");
    const lostStageId = meta.stageByLowerTitle.get("lost") ?? meta.stageByLowerTitle.get("verloren");
    if (stageAttr && (paidStageId || lostStageId)) {
      const ninetyAgo = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 90));
      const targetStageIds = [paidStageId, lostStageId].filter((x): x is string => !!x);
      const rows = await db
        .select({ recordId: recordValues.recordId, stageId: recordValues.textValue, updatedAt: records.updatedAt })
        .from(recordValues)
        .innerJoin(records, eq(records.id, recordValues.recordId))
        .where(
          and(
            eq(recordValues.attributeId, stageAttr.id),
            inArray(recordValues.textValue, targetStageIds),
            gte(records.updatedAt, ninetyAgo)
          )
        );
      let paid = 0;
      let lost = 0;
      for (const r of rows) {
        if (r.stageId === paidStageId) paid++;
        else if (r.stageId === lostStageId) lost++;
      }
      winRate90dPct = paid + lost > 0 ? Math.round((paid / (paid + lost)) * 100) : null;
    }

    // Outstanding: sum(value) − sum(payments) for deals in `Done` stage
    const doneStageId = meta.stageByLowerTitle.get("done") ?? meta.stageByLowerTitle.get("durchgeführt");
    if (stageAttr && valueAttr && doneStageId) {
      const doneDealRows = await db
        .select({ recordId: recordValues.recordId })
        .from(recordValues)
        .where(and(eq(recordValues.attributeId, stageAttr.id), eq(recordValues.textValue, doneStageId)));
      const doneDealIds = doneDealRows.map((r) => r.recordId);
      if (doneDealIds.length > 0) {
        const valueRows = await db
          .select({ recordId: recordValues.recordId, num: recordValues.numberValue })
          .from(recordValues)
          .where(and(eq(recordValues.attributeId, valueAttr.id), inArray(recordValues.recordId, doneDealIds)));
        const valueSum = valueRows.reduce((s, r) => s + Number(r.num ?? 0), 0);

        const paidRows = await db
          .select({ total: sum(payments.amount) })
          .from(payments)
          .where(and(eq(payments.workspaceId, workspaceId), inArray(payments.dealRecordId, doneDealIds)));
        const paidSum = Number(paidRows[0]?.total ?? 0);
        outstandingAmount = Math.max(0, valueSum - paidSum);
      }
    }

    // Moves scheduled this ISO week (deals.move_date)
    if (moveDateAttr) {
      const wkStart = startOfIsoWeek(now);
      const wkEnd = new Date(wkStart);
      wkEnd.setUTCDate(wkEnd.getUTCDate() + 7);
      const [{ cnt: weekCnt }] = await db
        .select({ cnt: sql<number>`count(*)::int` })
        .from(recordValues)
        .where(
          and(
            eq(recordValues.attributeId, moveDateAttr.id),
            gte(recordValues.dateValue, isoDate(wkStart)),
            lt(recordValues.dateValue, isoDate(wkEnd))
          )
        );
      movesThisWeek = Number(weekCnt ?? 0);
    }
  }

  return {
    revenueYtd,
    revenueMtd,
    revenueMtdDeltaPct,
    newLeads30d,
    winRate90dPct,
    outstandingAmount,
    movesThisWeek,
    revenueSeries8w,
    newLeadsSeries8w,
  };
}

function bucketBy8Weeks(
  weekly: { week: string; value: number }[],
  now: Date
): number[] {
  // Build 8 week-buckets ending with the current week (oldest → newest).
  const out: number[] = new Array(8).fill(0);
  const map = new Map<string, number>();
  for (const r of weekly) map.set(r.week, r.value);

  for (let i = 7; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 7 * i));
    const weekStart = startOfIsoWeek(d);
    const key = isoDate(weekStart);
    out[7 - i] = map.get(key) ?? 0;
  }
  return out;
}

// ─── Pipeline ────────────────────────────────────────────────────────────────

export interface PipelineStageBucket {
  stageId: string;
  title: string;
  color: string;
  sortOrder: number;
  count: number;
  totalValue: number;
}

export interface StaleDeal {
  dealId: string;
  name: string;
  stageTitle: string | null;
  daysStale: number;
}

export interface PipelineStats {
  stages: PipelineStageBucket[];
  staleDeals: StaleDeal[];
  avgTimeToCloseDays: number | null;
  avgQuoteValueOpen: number | null;
  avgQuoteValueWon: number | null;
}

export async function getPipelineStats(workspaceId: string): Promise<PipelineStats> {
  const meta = await loadDealMeta(workspaceId);
  if (!meta.dealObjectId) {
    return { stages: [], staleDeals: [], avgTimeToCloseDays: null, avgQuoteValueOpen: null, avgQuoteValueWon: null };
  }

  const allDeals = await db
    .select({ id: records.id, createdAt: records.createdAt, updatedAt: records.updatedAt })
    .from(records)
    .where(eq(records.objectId, meta.dealObjectId));
  const dealIds = allDeals.map((d) => d.id);

  const stageAttr = meta.attrBySlug.get("stage");
  const valueAttr = meta.attrBySlug.get("value");
  const nameAttr = meta.attrBySlug.get("name");

  const interestedIds = [stageAttr?.id, valueAttr?.id, nameAttr?.id].filter((x): x is string => !!x);
  const byRecord = await loadDealValues(dealIds, interestedIds);

  // Build stage buckets
  const buckets = new Map<string, PipelineStageBucket>();
  for (const [stageId, s] of meta.stageById.entries()) {
    buckets.set(stageId, {
      stageId,
      title: s.title,
      color: s.color,
      sortOrder: s.sortOrder,
      count: 0,
      totalValue: 0,
    });
  }
  for (const d of allDeals) {
    const v = byRecord.get(d.id);
    const stageId = v?.get(stageAttr?.id ?? "")?.textValue ?? null;
    const valNum = Number(v?.get(valueAttr?.id ?? "")?.numberValue ?? 0);
    if (stageId && buckets.has(stageId)) {
      const b = buckets.get(stageId)!;
      b.count++;
      b.totalValue += valNum;
    }
  }

  const stages = [...buckets.values()].sort((a, b) => a.sortOrder - b.sortOrder);

  // Stale deals: not updated in 14 days, still in an active stage
  const staleThreshold = new Date();
  staleThreshold.setUTCDate(staleThreshold.getUTCDate() - 14);
  const activeStageIds = new Set([...meta.stageById.entries()].filter(([_, s]) => s.isActive).map(([id]) => id));

  const staleDeals: StaleDeal[] = [];
  for (const d of allDeals) {
    if (d.updatedAt.getTime() > staleThreshold.getTime()) continue;
    const v = byRecord.get(d.id);
    const stageId = v?.get(stageAttr?.id ?? "")?.textValue ?? null;
    if (!stageId || !activeStageIds.has(stageId)) continue;
    const stage = meta.stageById.get(stageId);
    const days = Math.floor((Date.now() - d.updatedAt.getTime()) / 86400000);
    staleDeals.push({
      dealId: d.id,
      name: v?.get(nameAttr?.id ?? "")?.textValue ?? "—",
      stageTitle: stage?.title ?? null,
      daysStale: days,
    });
  }
  staleDeals.sort((a, b) => b.daysStale - a.daysStale);

  // Avg time-to-close (Paid deals in last 90d): from deal.createdAt to first payment.date
  const paidStageId = meta.stageByLowerTitle.get("paid") ?? meta.stageByLowerTitle.get("bezahlt (abgeschlossen)");
  let avgTimeToCloseDays: number | null = null;
  if (paidStageId && stageAttr) {
    const ninetyAgo = new Date();
    ninetyAgo.setUTCDate(ninetyAgo.getUTCDate() - 90);
    const paidDealRows = await db
      .select({ recordId: recordValues.recordId, updatedAt: records.updatedAt, createdAt: records.createdAt })
      .from(recordValues)
      .innerJoin(records, eq(records.id, recordValues.recordId))
      .where(
        and(
          eq(recordValues.attributeId, stageAttr.id),
          eq(recordValues.textValue, paidStageId),
          gte(records.updatedAt, ninetyAgo)
        )
      );
    if (paidDealRows.length > 0) {
      const paidDealIds = paidDealRows.map((r) => r.recordId);
      const firstPayments = await db
        .select({
          dealId: payments.dealRecordId,
          first: sql<string>`min(${payments.date})`,
        })
        .from(payments)
        .where(and(eq(payments.workspaceId, workspaceId), inArray(payments.dealRecordId, paidDealIds)))
        .groupBy(payments.dealRecordId);
      const firstByDeal = new Map(firstPayments.map((r) => [r.dealId, r.first]));
      const diffs: number[] = [];
      for (const d of paidDealRows) {
        const fp = firstByDeal.get(d.recordId);
        if (!fp) continue;
        const diff = (new Date(fp).getTime() - d.createdAt.getTime()) / 86400000;
        if (diff >= 0) diffs.push(diff);
      }
      if (diffs.length > 0) {
        avgTimeToCloseDays = Math.round(diffs.reduce((s, x) => s + x, 0) / diffs.length);
      }
    }
  }

  // Avg quote value open (active stages) vs. won (Paid)
  const activeIds = new Set<string>();
  for (const [id, s] of meta.stageById.entries()) if (s.isActive) activeIds.add(id);

  let openSum = 0;
  let openCnt = 0;
  let wonSum = 0;
  let wonCnt = 0;
  for (const d of allDeals) {
    const v = byRecord.get(d.id);
    const stageId = v?.get(stageAttr?.id ?? "")?.textValue ?? null;
    const valNum = Number(v?.get(valueAttr?.id ?? "")?.numberValue ?? 0);
    if (!stageId || valNum <= 0) continue;
    if (activeIds.has(stageId)) {
      openSum += valNum;
      openCnt++;
    } else if (stageId === paidStageId) {
      wonSum += valNum;
      wonCnt++;
    }
  }

  return {
    stages,
    staleDeals: staleDeals.slice(0, 20),
    avgTimeToCloseDays,
    avgQuoteValueOpen: openCnt > 0 ? Math.round(openSum / openCnt) : null,
    avgQuoteValueWon: wonCnt > 0 ? Math.round(wonSum / wonCnt) : null,
  };
}

// ─── Operations ──────────────────────────────────────────────────────────────

export interface OperationsStats {
  movesCompletedByMonth: { month: string; count: number }[];
  upcomingMoves: { date: string; count: number }[];
  transporterMix: { title: string; color: string; count: number }[];
  workerCountAvg: number | null;
  workerCountMin: number | null;
  workerCountMax: number | null;
  utilizationByWeek: { weekStart: string; count: number }[];
}

export async function getOperationsStats(workspaceId: string): Promise<OperationsStats> {
  const now = new Date();

  // Moves completed by month — use deals in stage `Done`/`Paid` with move_date in last 6 months
  const meta = await loadDealMeta(workspaceId);
  const movesCompletedByMonth: { month: string; count: number }[] = [];
  const upcomingMoves: { date: string; count: number }[] = [];
  const utilizationByWeek: { weekStart: string; count: number }[] = [];

  if (meta.dealObjectId) {
    const stageAttr = meta.attrBySlug.get("stage");
    const moveDateAttr = meta.attrBySlug.get("move_date");
    const doneStageId = meta.stageByLowerTitle.get("done") ?? meta.stageByLowerTitle.get("durchgeführt");
    const paidStageId = meta.stageByLowerTitle.get("paid") ?? meta.stageByLowerTitle.get("bezahlt (abgeschlossen)");

    if (stageAttr && moveDateAttr && (doneStageId || paidStageId)) {
      const completedStageIds = [doneStageId, paidStageId].filter((x): x is string => !!x);

      // Completed: deals in completed stage with move_date in last 6 months
      const sixMonthsAgo = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 5, 1));
      const completedDealRows = await db
        .select({ recordId: recordValues.recordId })
        .from(recordValues)
        .where(and(eq(recordValues.attributeId, stageAttr.id), inArray(recordValues.textValue, completedStageIds)));
      const completedIds = completedDealRows.map((r) => r.recordId);

      if (completedIds.length > 0) {
        const monthRows = await db
          .select({
            month: sql<string>`to_char(${recordValues.dateValue}, 'YYYY-MM')`,
            cnt: sql<number>`count(*)::int`,
          })
          .from(recordValues)
          .where(
            and(
              eq(recordValues.attributeId, moveDateAttr.id),
              inArray(recordValues.recordId, completedIds),
              gte(recordValues.dateValue, isoDate(sixMonthsAgo))
            )
          )
          .groupBy(sql`to_char(${recordValues.dateValue}, 'YYYY-MM')`);
        const monthMap = new Map(monthRows.map((r) => [r.month, Number(r.cnt ?? 0)]));
        for (let i = 5; i >= 0; i--) {
          const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
          const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
          movesCompletedByMonth.push({ month: key, count: monthMap.get(key) ?? 0 });
        }
      } else {
        for (let i = 5; i >= 0; i--) {
          const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
          const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
          movesCompletedByMonth.push({ month: key, count: 0 });
        }
      }

      // Upcoming moves: deals with move_date in next 14 days
      const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
      const in14 = new Date(today);
      in14.setUTCDate(in14.getUTCDate() + 14);
      const upcomingRows = await db
        .select({ date: recordValues.dateValue, cnt: sql<number>`count(*)::int` })
        .from(recordValues)
        .where(
          and(
            eq(recordValues.attributeId, moveDateAttr.id),
            gte(recordValues.dateValue, isoDate(today)),
            lt(recordValues.dateValue, isoDate(in14))
          )
        )
        .groupBy(recordValues.dateValue)
        .orderBy(recordValues.dateValue);
      for (const r of upcomingRows) upcomingMoves.push({ date: r.date ?? "", count: Number(r.cnt ?? 0) });

      // Utilization next 8 weeks
      const wkStart = startOfIsoWeek(today);
      const eightWeeks = new Date(wkStart);
      eightWeeks.setUTCDate(eightWeeks.getUTCDate() + 7 * 8);
      const weekRows = await db
        .select({
          weekStart: sql<string>`to_char(date_trunc('week', ${recordValues.dateValue}::date), 'YYYY-MM-DD')`,
          cnt: sql<number>`count(*)::int`,
        })
        .from(recordValues)
        .where(
          and(
            eq(recordValues.attributeId, moveDateAttr.id),
            gte(recordValues.dateValue, isoDate(wkStart)),
            lt(recordValues.dateValue, isoDate(eightWeeks))
          )
        )
        .groupBy(sql`date_trunc('week', ${recordValues.dateValue}::date)`);
      const wkMap = new Map(weekRows.map((r) => [r.weekStart, Number(r.cnt ?? 0)]));
      for (let i = 0; i < 8; i++) {
        const d = new Date(wkStart);
        d.setUTCDate(d.getUTCDate() + 7 * i);
        const key = isoDate(d);
        utilizationByWeek.push({ weekStart: key, count: wkMap.get(key) ?? 0 });
      }
    }
  }

  // Transporter mix + worker count from Aufträge object
  const transporterMix: { title: string; color: string; count: number }[] = [];
  let workerCountAvg: number | null = null;
  let workerCountMin: number | null = null;
  let workerCountMax: number | null = null;

  const [auftragObj] = await db
    .select({ id: objects.id })
    .from(objects)
    .where(and(eq(objects.workspaceId, workspaceId), eq(objects.slug, "auftraege")))
    .limit(1);

  if (auftragObj) {
    const auftragAttrs = await db
      .select({ id: attributes.id, slug: attributes.slug })
      .from(attributes)
      .where(eq(attributes.objectId, auftragObj.id));
    const auftragAttrBySlug = new Map(auftragAttrs.map((a) => [a.slug, a.id]));

    const transporterAttrId = auftragAttrBySlug.get("transporter");
    const workerCountAttrId = auftragAttrBySlug.get("worker_count");

    if (transporterAttrId) {
      const optionRows = await db
        .select({ id: selectOptions.id, title: selectOptions.title, color: selectOptions.color })
        .from(selectOptions)
        .where(eq(selectOptions.attributeId, transporterAttrId));
      const optMap = new Map(optionRows.map((o) => [o.id, { title: o.title, color: o.color }]));

      const ninetyAgo = new Date();
      ninetyAgo.setUTCDate(ninetyAgo.getUTCDate() - 90);
      const transporterRows = await db
        .select({ value: recordValues.textValue, cnt: sql<number>`count(*)::int` })
        .from(recordValues)
        .innerJoin(records, eq(records.id, recordValues.recordId))
        .where(
          and(
            eq(recordValues.attributeId, transporterAttrId),
            gte(records.createdAt, ninetyAgo)
          )
        )
        .groupBy(recordValues.textValue);
      for (const r of transporterRows) {
        const opt = r.value ? optMap.get(r.value) : null;
        if (opt) transporterMix.push({ title: opt.title, color: opt.color, count: Number(r.cnt ?? 0) });
      }
      transporterMix.sort((a, b) => b.count - a.count);
    }

    if (workerCountAttrId) {
      const [wcRow] = await db
        .select({
          avg: sql<number>`avg(${recordValues.numberValue})::float`,
          min: sql<number>`min(${recordValues.numberValue})::float`,
          max: sql<number>`max(${recordValues.numberValue})::float`,
        })
        .from(recordValues)
        .where(eq(recordValues.attributeId, workerCountAttrId));
      workerCountAvg = wcRow?.avg != null ? Math.round(Number(wcRow.avg) * 10) / 10 : null;
      workerCountMin = wcRow?.min != null ? Number(wcRow.min) : null;
      workerCountMax = wcRow?.max != null ? Number(wcRow.max) : null;
    }
  }

  return {
    movesCompletedByMonth,
    upcomingMoves,
    transporterMix,
    workerCountAvg,
    workerCountMin,
    workerCountMax,
    utilizationByWeek,
  };
}

// ─── Team / Productivity ─────────────────────────────────────────────────────

export interface TeamStats {
  tasksByWeek: { weekStart: string; completed: number; overdue: number }[];
  dealsByOwner: { ownerId: string; count: number }[];
  newLeadsByOwner30d: { ownerId: string; count: number }[];
}

export async function getTeamStats(workspaceId: string): Promise<TeamStats> {
  const now = new Date();
  const eightWeeksAgo = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 7 * 8));

  // Completed tasks by week (last 8 weeks)
  const completedRows = await db
    .select({
      week: sql<string>`to_char(date_trunc('week', ${tasks.completedAt}), 'YYYY-MM-DD')`,
      cnt: sql<number>`count(*)::int`,
    })
    .from(tasks)
    .where(
      and(
        eq(tasks.workspaceId, workspaceId),
        eq(tasks.isCompleted, true),
        sql`${tasks.completedAt} IS NOT NULL`,
        gte(tasks.completedAt, eightWeeksAgo)
      )
    )
    .groupBy(sql`date_trunc('week', ${tasks.completedAt})`);

  // Overdue tasks (open, deadline passed) — bucket by the deadline week
  const overdueRows = await db
    .select({
      week: sql<string>`to_char(date_trunc('week', ${tasks.deadline}), 'YYYY-MM-DD')`,
      cnt: sql<number>`count(*)::int`,
    })
    .from(tasks)
    .where(
      and(
        eq(tasks.workspaceId, workspaceId),
        eq(tasks.isCompleted, false),
        sql`${tasks.deadline} IS NOT NULL`,
        lt(tasks.deadline, now),
        gte(tasks.deadline, eightWeeksAgo)
      )
    )
    .groupBy(sql`date_trunc('week', ${tasks.deadline})`);

  const completedMap = new Map(completedRows.map((r) => [r.week, Number(r.cnt ?? 0)]));
  const overdueMap = new Map(overdueRows.map((r) => [r.week, Number(r.cnt ?? 0)]));
  const tasksByWeek: { weekStart: string; completed: number; overdue: number }[] = [];
  for (let i = 7; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 7 * i));
    const wk = startOfIsoWeek(d);
    const key = isoDate(wk);
    tasksByWeek.push({
      weekStart: key,
      completed: completedMap.get(key) ?? 0,
      overdue: overdueMap.get(key) ?? 0,
    });
  }

  // Deals per owner + new leads per owner (last 30 days)
  const meta = await loadDealMeta(workspaceId);
  const dealsByOwner: { ownerId: string; count: number }[] = [];
  const newLeadsByOwner30d: { ownerId: string; count: number }[] = [];

  const ownerAttr = meta.attrBySlug.get("owner");
  if (meta.dealObjectId && ownerAttr) {
    const allRows = await db
      .select({ ownerId: recordValues.actorId, cnt: sql<number>`count(*)::int` })
      .from(recordValues)
      .innerJoin(records, eq(records.id, recordValues.recordId))
      .where(
        and(
          eq(recordValues.attributeId, ownerAttr.id),
          eq(records.objectId, meta.dealObjectId),
          sql`${recordValues.actorId} IS NOT NULL`
        )
      )
      .groupBy(recordValues.actorId);
    for (const r of allRows) {
      if (r.ownerId) dealsByOwner.push({ ownerId: r.ownerId, count: Number(r.cnt ?? 0) });
    }
    dealsByOwner.sort((a, b) => b.count - a.count);

    const thirtyAgo = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 30));
    const newRows = await db
      .select({ ownerId: recordValues.actorId, cnt: sql<number>`count(*)::int` })
      .from(recordValues)
      .innerJoin(records, eq(records.id, recordValues.recordId))
      .where(
        and(
          eq(recordValues.attributeId, ownerAttr.id),
          eq(records.objectId, meta.dealObjectId),
          gte(records.createdAt, thirtyAgo),
          sql`${recordValues.actorId} IS NOT NULL`
        )
      )
      .groupBy(recordValues.actorId);
    for (const r of newRows) {
      if (r.ownerId) newLeadsByOwner30d.push({ ownerId: r.ownerId, count: Number(r.cnt ?? 0) });
    }
    newLeadsByOwner30d.sort((a, b) => b.count - a.count);
  }

  return { tasksByWeek, dealsByOwner, newLeadsByOwner30d };
}

// ─── Operating-company comparison ────────────────────────────────────────────

export interface CompanyComparisonRow {
  companyId: string;
  companyName: string;
  revenue: number;
  expenses: number;
  employeeCosts: number;
  margin: number;
  marginPct: number | null;
  dealsWon: number;
  dealsLost: number;
  winRatePct: number | null;
  avgDealValue: number | null;
}

export async function getCompanyComparison(
  workspaceId: string,
  period: Period
): Promise<CompanyComparisonRow[]> {
  const { start } = periodRange(period);
  const startIso = isoDate(start);

  const meta = await loadDealMeta(workspaceId);
  if (!meta.dealObjectId) return [];

  // Map deal → operating_company
  const ocAttr = meta.attrBySlug.get("operating_company");
  const stageAttr = meta.attrBySlug.get("stage");
  const valueAttr = meta.attrBySlug.get("value");

  const dealOcRows = ocAttr
    ? await db
        .select({ dealId: recordValues.recordId, ocId: recordValues.referencedRecordId })
        .from(recordValues)
        .where(and(eq(recordValues.attributeId, ocAttr.id), sql`${recordValues.referencedRecordId} IS NOT NULL`))
    : [];
  const dealToOc = new Map<string, string>();
  for (const r of dealOcRows) if (r.ocId) dealToOc.set(r.dealId, r.ocId);

  const allOcIds = new Set([...dealToOc.values()]);

  // Revenue per company (payments in period)
  const paymentRows = await db
    .select({ dealId: payments.dealRecordId, amount: payments.amount })
    .from(payments)
    .where(and(eq(payments.workspaceId, workspaceId), gte(payments.date, startIso)));
  // Expenses
  const expenseRows = await db
    .select({ dealId: expenses.dealRecordId, amount: expenses.amount, payingOc: expenses.payingOperatingCompanyId })
    .from(expenses)
    .where(and(eq(expenses.workspaceId, workspaceId), gte(expenses.date, startIso)));
  // Employee costs
  const empRows = await db
    .select({ dealId: employeeTransactions.dealRecordId, amount: employeeTransactions.amount, payingOc: employeeTransactions.payingOperatingCompanyId })
    .from(employeeTransactions)
    .where(
      and(
        eq(employeeTransactions.workspaceId, workspaceId),
        gte(employeeTransactions.date, startIso),
        sql`${employeeTransactions.type} IN ('salary', 'advance')`
      )
    );

  const blank = () => ({
    revenue: 0,
    expenses: 0,
    employeeCosts: 0,
    wonValueSum: 0,
    wonCount: 0,
    lostCount: 0,
  });
  const byOc = new Map<string, ReturnType<typeof blank>>();
  const bump = (id: string) => {
    let r = byOc.get(id);
    if (!r) {
      r = blank();
      byOc.set(id, r);
    }
    allOcIds.add(id);
    return r;
  };

  for (const p of paymentRows) {
    const oc = dealToOc.get(p.dealId);
    if (oc) bump(oc).revenue += Number(p.amount);
  }
  for (const e of expenseRows) {
    const effective = e.payingOc ?? dealToOc.get(e.dealId);
    if (effective) bump(effective).expenses += Number(e.amount);
  }
  for (const t of empRows) {
    const effective = t.payingOc ?? dealToOc.get(t.dealId);
    if (effective) bump(effective).employeeCosts += Number(t.amount);
  }

  // Win/loss + avg deal value — within the period, based on `records.updatedAt`
  const paidId = meta.stageByLowerTitle.get("paid") ?? meta.stageByLowerTitle.get("bezahlt (abgeschlossen)");
  const lostId = meta.stageByLowerTitle.get("lost") ?? meta.stageByLowerTitle.get("verloren");

  if (stageAttr && (paidId || lostId)) {
    const wonLostStageIds = [paidId, lostId].filter((x): x is string => !!x);
    const decisionRows = await db
      .select({ dealId: recordValues.recordId, stageId: recordValues.textValue })
      .from(recordValues)
      .innerJoin(records, eq(records.id, recordValues.recordId))
      .where(
        and(
          eq(recordValues.attributeId, stageAttr.id),
          inArray(recordValues.textValue, wonLostStageIds),
          gte(records.updatedAt, start)
        )
      );

    // Pull deal values in bulk
    let valueByDeal = new Map<string, number>();
    if (valueAttr && decisionRows.length > 0) {
      const valueRows = await db
        .select({ dealId: recordValues.recordId, num: recordValues.numberValue })
        .from(recordValues)
        .where(
          and(
            eq(recordValues.attributeId, valueAttr.id),
            inArray(recordValues.recordId, decisionRows.map((r) => r.dealId))
          )
        );
      valueByDeal = new Map(valueRows.map((r) => [r.dealId, Number(r.num ?? 0)]));
    }

    for (const d of decisionRows) {
      const oc = dealToOc.get(d.dealId);
      if (!oc) continue;
      const r = bump(oc);
      const v = valueByDeal.get(d.dealId) ?? 0;
      if (d.stageId === paidId) {
        r.wonCount++;
        r.wonValueSum += v;
      } else if (d.stageId === lostId) {
        r.lostCount++;
      }
    }
  }

  // Names
  const names = await loadOperatingCompanyNames(workspaceId, [...allOcIds]);

  const out: CompanyComparisonRow[] = [];
  for (const [companyId, r] of byOc.entries()) {
    const margin = r.revenue - r.expenses - r.employeeCosts;
    const decisions = r.wonCount + r.lostCount;
    out.push({
      companyId,
      companyName: names.get(companyId) ?? "Unbekannt",
      revenue: r.revenue,
      expenses: r.expenses,
      employeeCosts: r.employeeCosts,
      margin,
      marginPct: r.revenue > 0 ? Math.round((margin / r.revenue) * 100) : null,
      dealsWon: r.wonCount,
      dealsLost: r.lostCount,
      winRatePct: decisions > 0 ? Math.round((r.wonCount / decisions) * 100) : null,
      avgDealValue: r.wonCount > 0 ? Math.round(r.wonValueSum / r.wonCount) : null,
    });
  }
  out.sort((a, b) => b.revenue - a.revenue);
  return out;
}
