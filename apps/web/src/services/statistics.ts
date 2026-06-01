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
import { payments, expenses } from "@/db/schema/financial";
import { employeeLedger } from "@/db/schema/employee-ledger";
import { tasks } from "@/db/schema/tasks";
import { inboxConversations, channelAccounts, inboxContacts } from "@/db/schema/inbox";

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

export type LeadChannelType = "email" | "whatsapp" | "sms";

export type LeadSource =
  | "kleinanzeigen"
  | "whatsapp"
  | "sms"
  | "email_direct"
  | "immobilienscout"
  | "other";

const KLEINANZEIGEN_RELAY_RE = /@mail\.kleinanzeigen\.de$/i;
const KLEINANZEIGEN_SUBJECT_RE =
  /kleinanzeigen|nutzer-anfrage|anfrage zu deiner anzeige|zu ihrer anzeige/i;
const IMMOSCOUT_RE = /immobilienscout|immoscout|immowelt/i;

// Patterns that almost certainly mean "this is not a real customer reaching
// out". Kept conservative on purpose — false positives (a real customer using
// info@ from their work address) cost more than false negatives.
const NONLEAD_SENDER_LOCALPART_RE =
  /^(no[-_.]?reply|donot[-_.]?reply|noreply|mailer-daemon|postmaster|bounces?|delivery|delivery-status|notifications?|alerts?|automated?|auto-confirm|newsletter|marketing|promo|promotions?|hello|support|billing|invoice|invoicing|abuse|security|noreply2?|reply\+|notify)$/i;
const NONLEAD_SUBJECT_RE =
  /(newsletter|unsubscribe|abmelden|abmeldung|out of office|abwesenheits|delivery status|undeliverable|mail delivery|returned mail|payment receipt|invoice|rechnung von|kontoauszug|password reset|verify your|verifizierung|2fa|two-factor|webinar|sale ends|black friday|cyber monday)/i;

function isNonLeadEmail(
  channelType: string,
  contactEmail: string | null,
  subject: string | null
): boolean {
  if (channelType !== "email") return false;
  // Never filter out Kleinanzeigen relay — those are real leads even though the
  // local-part can look randomised.
  if (contactEmail && KLEINANZEIGEN_RELAY_RE.test(contactEmail)) return false;
  if (subject && KLEINANZEIGEN_SUBJECT_RE.test(subject)) return false;

  if (contactEmail) {
    const local = contactEmail.split("@")[0] ?? "";
    if (NONLEAD_SENDER_LOCALPART_RE.test(local)) return true;
  }
  if (subject && NONLEAD_SUBJECT_RE.test(subject)) return true;
  return false;
}

function classifyLeadSource(
  channelType: string,
  contactEmail: string | null,
  subject: string | null
): LeadSource {
  if (channelType === "whatsapp") return "whatsapp";
  if (channelType === "sms") return "sms";
  // email channel
  if (contactEmail && KLEINANZEIGEN_RELAY_RE.test(contactEmail)) return "kleinanzeigen";
  if (subject && KLEINANZEIGEN_SUBJECT_RE.test(subject)) return "kleinanzeigen";
  if (contactEmail && IMMOSCOUT_RE.test(contactEmail)) return "immobilienscout";
  if (subject && IMMOSCOUT_RE.test(subject)) return "immobilienscout";
  return "email_direct";
}

export interface CompanyComparisonRow {
  companyId: string;
  companyName: string;
  // Financial
  revenue: number;
  expenses: number;
  employeeCosts: number;
  margin: number;
  marginPct: number | null;
  // Pipeline
  dealsWon: number;
  dealsLost: number;
  winRatePct: number | null;
  avgDealValue: number | null;
  // Operations
  movesCompleted: number;
  revenuePerMove: number | null;
  costPerMove: number | null;
  // Efficiency
  laborRatioPct: number | null;
  expenseRatioPct: number | null;
  // Cross-subsidy (Quersubvention)
  crossSubsidyIn: number;
  crossSubsidyOut: number;
  // Lead intake. newLeads counts unique contacts per OC per channel within the
  // period, after filtering out noreply / mailer-daemon / newsletter / system
  // notification emails. filteredOutLeads is the number of unique contacts
  // dropped by that filter — surfaced so operators can sanity-check it.
  newLeads: number;
  filteredOutLeads: number;
  leadsByChannel: { channelType: LeadChannelType; count: number }[];
  leadsBySource: { source: LeadSource; count: number }[];
  leadToWinRatePct: number | null;
  // Trend (oldest to newest, last 6 months)
  monthlySeries: {
    month: string;
    revenue: number;
    profit: number;
    moves: number;
    leads: number;
  }[];
  // Composite score (0 to 100)
  score: number;
}

export async function getCompanyComparison(
  workspaceId: string,
  period: Period
): Promise<CompanyComparisonRow[]> {
  const { start } = periodRange(period);
  const startIso = isoDate(start);
  const now = new Date();

  // Six-month window for trend (covers the longest period 365d but capped to 6 months for chart density).
  const sixMonthsAgo = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 5, 1));
  const sixMonthsAgoIso = isoDate(sixMonthsAgo);

  const meta = await loadDealMeta(workspaceId);
  if (!meta.dealObjectId) return [];

  const ocAttr = meta.attrBySlug.get("operating_company");
  const stageAttr = meta.attrBySlug.get("stage");
  const valueAttr = meta.attrBySlug.get("value");
  const moveDateAttr = meta.attrBySlug.get("move_date");

  // ── Deal → OC mapping ──────────────────────────────────────────────────────
  const dealOcRows = ocAttr
    ? await db
        .select({ dealId: recordValues.recordId, ocId: recordValues.referencedRecordId })
        .from(recordValues)
        .where(and(eq(recordValues.attributeId, ocAttr.id), sql`${recordValues.referencedRecordId} IS NOT NULL`))
    : [];
  const dealToOc = new Map<string, string>();
  for (const r of dealOcRows) if (r.ocId) dealToOc.set(r.dealId, r.ocId);

  const allOcIds = new Set([...dealToOc.values()]);

  // ── Raw rows for the period ────────────────────────────────────────────────
  const paymentRows = await db
    .select({ dealId: payments.dealRecordId, amount: payments.amount, date: payments.date })
    .from(payments)
    .where(and(eq(payments.workspaceId, workspaceId), gte(payments.date, sixMonthsAgoIso)));

  const expenseRows = await db
    .select({
      dealId: expenses.dealRecordId,
      amount: expenses.amount,
      payingOc: expenses.payingOperatingCompanyId,
      date: expenses.date,
    })
    .from(expenses)
    .where(and(eq(expenses.workspaceId, workspaceId), gte(expenses.date, sixMonthsAgoIso)));

  const empRows = await db
    .select({
      dealId: employeeLedger.dealRecordId,
      operatingCompanyId: employeeLedger.operatingCompanyId,
      amount: employeeLedger.amount,
      payingOc: employeeLedger.payingOperatingCompanyId,
      date: employeeLedger.date,
    })
    .from(employeeLedger)
    .where(
      and(
        eq(employeeLedger.workspaceId, workspaceId),
        gte(employeeLedger.date, sixMonthsAgoIso),
        eq(employeeLedger.kind, "earning")
      )
    );

  // ── Per-OC accumulators ────────────────────────────────────────────────────
  const blank = () => ({
    revenue: 0,
    expenses: 0,
    employeeCosts: 0,
    wonValueSum: 0,
    wonCount: 0,
    lostCount: 0,
    movesCompleted: 0,
    crossIn: 0,
    crossOut: 0,
    newLeads: 0,
    filteredOutLeads: 0,
    leadsByChannel: new Map<LeadChannelType, number>(),
    leadsBySource: new Map<LeadSource, number>(),
    monthly: new Map<
      string,
      { revenue: number; expenses: number; employeeCosts: number; moves: number; leads: number }
    >(),
  });
  type Bucket = ReturnType<typeof blank>;
  const byOc = new Map<string, Bucket>();
  const bump = (id: string): Bucket => {
    let r = byOc.get(id);
    if (!r) {
      r = blank();
      byOc.set(id, r);
    }
    allOcIds.add(id);
    return r;
  };
  const monthBucket = (b: Bucket, monthKey: string) => {
    let m = b.monthly.get(monthKey);
    if (!m) {
      m = { revenue: 0, expenses: 0, employeeCosts: 0, moves: 0, leads: 0 };
      b.monthly.set(monthKey, m);
    }
    return m;
  };
  const monthKey = (iso: string | null) => (iso ?? "").slice(0, 7);
  const inPeriod = (iso: string | null) => !!iso && iso >= startIso;

  // ── Revenue: by deal owner OC ──────────────────────────────────────────────
  for (const p of paymentRows) {
    const oc = dealToOc.get(p.dealId);
    if (!oc) continue;
    const amt = Number(p.amount);
    const b = bump(oc);
    if (inPeriod(p.date)) b.revenue += amt;
    monthBucket(b, monthKey(p.date)).revenue += amt;
  }

  // ── Expenses + cross-subsidy bookkeeping ──────────────────────────────────
  for (const e of expenseRows) {
    const dealOp = dealToOc.get(e.dealId) ?? null;
    const effectivePayer = e.payingOc ?? dealOp;
    if (!effectivePayer) continue;
    const amt = Number(e.amount);
    const isCross = e.payingOc !== null && dealOp !== null && e.payingOc !== dealOp;

    const payer = bump(effectivePayer);
    if (inPeriod(e.date)) {
      payer.expenses += amt;
      if (isCross) payer.crossOut += amt;
    }
    monthBucket(payer, monthKey(e.date)).expenses += amt;

    if (isCross && dealOp && inPeriod(e.date)) {
      bump(dealOp).crossIn += amt;
    }
  }

  for (const t of empRows) {
    const dealOp = t.dealId
      ? dealToOc.get(t.dealId) ?? null
      : t.operatingCompanyId ?? null;
    const effectivePayer = t.payingOc ?? dealOp;
    if (!effectivePayer) continue;
    const amt = Number(t.amount);
    const isCross = t.payingOc !== null && dealOp !== null && t.payingOc !== dealOp;

    const payer = bump(effectivePayer);
    if (inPeriod(t.date)) {
      payer.employeeCosts += amt;
      if (isCross) payer.crossOut += amt;
    }
    monthBucket(payer, monthKey(t.date)).employeeCosts += amt;

    if (isCross && dealOp && inPeriod(t.date)) {
      bump(dealOp).crossIn += amt;
    }
  }

  // ── Win / loss / avg deal value ───────────────────────────────────────────
  const paidId = meta.stageByLowerTitle.get("paid") ?? meta.stageByLowerTitle.get("bezahlt (abgeschlossen)");
  const lostId = meta.stageByLowerTitle.get("lost") ?? meta.stageByLowerTitle.get("verloren");
  const doneId = meta.stageByLowerTitle.get("done") ?? meta.stageByLowerTitle.get("durchgeführt");

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

  // ── Completed moves: deals in Done/Paid with move_date in period (+monthly) ─
  if (stageAttr && moveDateAttr && (doneId || paidId)) {
    const completedStageIds = [doneId, paidId].filter((x): x is string => !!x);
    const completedDealRows = await db
      .select({ recordId: recordValues.recordId })
      .from(recordValues)
      .where(
        and(eq(recordValues.attributeId, stageAttr.id), inArray(recordValues.textValue, completedStageIds))
      );
    const completedIds = completedDealRows.map((r) => r.recordId);

    if (completedIds.length > 0) {
      const moveDateRows = await db
        .select({ dealId: recordValues.recordId, moveDate: recordValues.dateValue })
        .from(recordValues)
        .where(
          and(
            eq(recordValues.attributeId, moveDateAttr.id),
            inArray(recordValues.recordId, completedIds),
            gte(recordValues.dateValue, sixMonthsAgoIso)
          )
        );

      for (const m of moveDateRows) {
        const oc = dealToOc.get(m.dealId);
        if (!oc) continue;
        const b = bump(oc);
        if (inPeriod(m.moveDate)) b.movesCompleted += 1;
        monthBucket(b, monthKey(m.moveDate)).moves += 1;
      }
    }
  }

  // ── Lead intake from inbox conversations (+monthly) ────────────────────────
  //
  // Counting rule: one lead = one unique CONTACT per OC per channel within the
  // period. So a person who starts five separate email threads with Kottke is
  // one Kottke email lead. A person who messages both Kottke and Ceylan counts
  // once per OC. A person who reaches the same OC via both email and WhatsApp
  // counts once per channel (because channel is part of the dedup key) — that
  // matches the user's stated rule that multi-channel intake is multiple leads.
  //
  // For the source breakdown we keep the same per-(contact, channel) dedup but
  // assign source from the FIRST conversation we see for that contact/channel
  // pair (sorted ascending by createdAt) so the breakdown total agrees with
  // newLeads.
  //
  // Source classification uses contact email + subject regex matching the
  // inbox UI logic (Kleinanzeigen relay address / subject keywords, Immoscout
  // sender domain) so the breakdown agrees with what operators see.
  const convoRows = await db
    .select({
      contactId: inboxConversations.contactId,
      externalThreadId: inboxConversations.externalThreadId,
      subject: inboxConversations.subject,
      ocId: channelAccounts.operatingCompanyRecordId,
      channelType: channelAccounts.channelType,
      contactEmail: inboxContacts.email,
      createdAt: inboxConversations.createdAt,
    })
    .from(inboxConversations)
    .innerJoin(channelAccounts, eq(channelAccounts.id, inboxConversations.channelAccountId))
    .innerJoin(inboxContacts, eq(inboxContacts.id, inboxConversations.contactId))
    .where(
      and(
        eq(inboxConversations.workspaceId, workspaceId),
        gte(inboxConversations.createdAt, sixMonthsAgo)
      )
    )
    .orderBy(inboxConversations.createdAt);

  // Dedup key: (ocId, contactId, channelType). The first occurrence wins for
  // both the period count and the monthly bucket.
  const seenInPeriod = new Set<string>();
  const seenAllTime = new Set<string>();

  for (const c of convoRows) {
    if (!c.ocId) continue;
    const key = `${c.ocId}|${c.contactId}|${c.channelType}`;
    const createdIso = c.createdAt instanceof Date ? c.createdAt.toISOString().slice(0, 10) : null;
    const source = classifyLeadSource(c.channelType, c.contactEmail, c.subject);
    const ch = c.channelType as LeadChannelType;
    const isJunk = isNonLeadEmail(c.channelType, c.contactEmail, c.subject);

    // Monthly bucket: count first real-lead sighting in any month.
    if (!seenAllTime.has(key)) {
      seenAllTime.add(key);
      if (!isJunk) {
        const b = bump(c.ocId);
        monthBucket(b, monthKey(createdIso)).leads += 1;
      }
    }

    // Period count: count first sighting inside the selected period.
    if (inPeriod(createdIso) && !seenInPeriod.has(key)) {
      seenInPeriod.add(key);
      const b = bump(c.ocId);
      if (isJunk) {
        b.filteredOutLeads += 1;
      } else {
        b.newLeads += 1;
        b.leadsByChannel.set(ch, (b.leadsByChannel.get(ch) ?? 0) + 1);
        b.leadsBySource.set(source, (b.leadsBySource.get(source) ?? 0) + 1);
      }
    }
  }

  // ── Resolve OC names ───────────────────────────────────────────────────────
  const names = await loadOperatingCompanyNames(workspaceId, [...allOcIds]);

  // ── Build six-month series (oldest to newest) for each OC ──────────────────
  const monthKeys: string[] = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    monthKeys.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
  }

  // ── First pass: assemble rows without composite score ──────────────────────
  type Pre = Omit<CompanyComparisonRow, "score">;
  const pre: Pre[] = [];
  for (const [companyId, r] of byOc.entries()) {
    const margin = r.revenue - r.expenses - r.employeeCosts;
    const decisions = r.wonCount + r.lostCount;
    const marginPct = r.revenue > 0 ? Math.round((margin / r.revenue) * 100) : null;
    const winRatePct = decisions > 0 ? Math.round((r.wonCount / decisions) * 100) : null;
    const laborRatioPct = r.revenue > 0 ? Math.round((r.employeeCosts / r.revenue) * 100) : null;
    const expenseRatioPct = r.revenue > 0 ? Math.round((r.expenses / r.revenue) * 100) : null;
    const revenuePerMove = r.movesCompleted > 0 ? Math.round(r.revenue / r.movesCompleted) : null;
    const costPerMove =
      r.movesCompleted > 0
        ? Math.round((r.expenses + r.employeeCosts) / r.movesCompleted)
        : null;
    const leadToWinRatePct =
      r.newLeads > 0 ? Math.round((r.wonCount / r.newLeads) * 100) : null;

    const leadsByChannel: { channelType: LeadChannelType; count: number }[] = [
      "email",
      "whatsapp",
      "sms",
    ].map((c) => ({
      channelType: c as LeadChannelType,
      count: r.leadsByChannel.get(c as LeadChannelType) ?? 0,
    }));

    const leadsBySource: { source: LeadSource; count: number }[] = [
      "kleinanzeigen",
      "whatsapp",
      "sms",
      "email_direct",
      "immobilienscout",
      "other",
    ]
      .map((s) => ({
        source: s as LeadSource,
        count: r.leadsBySource.get(s as LeadSource) ?? 0,
      }))
      .filter((s) => s.count > 0);

    const monthlySeries = monthKeys.map((mk) => {
      const m = r.monthly.get(mk) ?? {
        revenue: 0,
        expenses: 0,
        employeeCosts: 0,
        moves: 0,
        leads: 0,
      };
      return {
        month: mk,
        revenue: Math.round(m.revenue),
        profit: Math.round(m.revenue - m.expenses - m.employeeCosts),
        moves: m.moves,
        leads: m.leads,
      };
    });

    pre.push({
      companyId,
      companyName: names.get(companyId) ?? "Unbekannt",
      revenue: r.revenue,
      expenses: r.expenses,
      employeeCosts: r.employeeCosts,
      margin,
      marginPct,
      dealsWon: r.wonCount,
      dealsLost: r.lostCount,
      winRatePct,
      avgDealValue: r.wonCount > 0 ? Math.round(r.wonValueSum / r.wonCount) : null,
      movesCompleted: r.movesCompleted,
      revenuePerMove,
      costPerMove,
      laborRatioPct,
      expenseRatioPct,
      crossSubsidyIn: r.crossIn,
      crossSubsidyOut: r.crossOut,
      newLeads: r.newLeads,
      filteredOutLeads: r.filteredOutLeads,
      leadsByChannel,
      leadsBySource,
      leadToWinRatePct,
      monthlySeries,
    });
  }

  // ── Composite score (40% Marge% · 30% Umsatz · 20% Win-Rate · 10% Volumen) ─
  const maxRevenue = Math.max(...pre.map((p) => p.revenue), 1);
  const maxMoves = Math.max(...pre.map((p) => p.movesCompleted), 1);
  const out: CompanyComparisonRow[] = pre.map((p) => {
    const marginScore = Math.max(0, Math.min(100, p.marginPct ?? 0));
    const revenueScore = (p.revenue / maxRevenue) * 100;
    const winScore = p.winRatePct ?? 0;
    const volumeScore = (p.movesCompleted / maxMoves) * 100;
    const score = Math.round(
      0.4 * marginScore + 0.3 * revenueScore + 0.2 * winScore + 0.1 * volumeScore
    );
    return { ...p, score };
  });

  out.sort((a, b) => b.score - a.score);
  return out;
}
