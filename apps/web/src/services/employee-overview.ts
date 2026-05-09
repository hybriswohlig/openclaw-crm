import { db } from "@/db";
import {
  employees,
  dealEmployees,
  employeeTransactions,
  records,
  recordValues,
  attributes,
  objects,
} from "@/db/schema";
import { and, eq, inArray, sql } from "drizzle-orm";

/**
 * Per-employee v1 row for the team dashboard (KOT-589).
 *
 * Numeric fields that we cannot compute yet (avgRating without any rated
 * jobs, onTimePct without any actual_start data) come back as null so the
 * UI can render `—` instead of a fake zero.
 */
export interface EmployeeOverviewRow {
  id: string;
  name: string;
  role: string | null;
  status: "active" | "on_leave" | "inactive";
  photoBase64: string | null;
  hourlyRate: string;
  jobsThisMonth: number;
  hoursThisMonth: number;
  paidYtd: number;
  owedNow: number;
  avgRating: number | null;
  ratedJobCount: number;
  onTimePct: number | null;
  onTimeJobCount: number;
  lastJobDate: string | null;
}

interface DealJobInfo {
  /** Day of the move from `move_date` (date) on the deal. */
  moveDate: string | null;
  /** Auftrag scheduled start, if any. */
  scheduledStart: Date | null;
  /** Auftrag scheduled end, if any. */
  scheduledEnd: Date | null;
  /** Auftrag actual start, if any (used for on-time %). */
  actualStart: Date | null;
  /** Auftrag customer rating (1–5), if any. */
  customerRating: number | null;
}

function startOfMonth(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
}

function startOfYear(): string {
  return `${new Date().getFullYear()}-01-01`;
}

function isoDay(date: Date | string | null): string | null {
  if (!date) return null;
  if (typeof date === "string") return date.length >= 10 ? date.slice(0, 10) : date;
  return date.toISOString().slice(0, 10);
}

export async function getEmployeeOverview(
  workspaceId: string
): Promise<EmployeeOverviewRow[]> {
  // 1) Base employees rows.
  const empRows = await db
    .select({
      id: employees.id,
      name: employees.name,
      role: employees.role,
      status: employees.status,
      photoBase64: employees.photoBase64,
      hourlyRate: employees.hourlyRate,
    })
    .from(employees)
    .where(eq(employees.workspaceId, workspaceId))
    .orderBy(employees.name);

  if (empRows.length === 0) return [];

  // 2) All assignments → we'll resolve per-deal info once.
  const assignments = await db
    .select({
      employeeId: dealEmployees.employeeId,
      dealRecordId: dealEmployees.dealRecordId,
    })
    .from(dealEmployees)
    .innerJoin(employees, eq(employees.id, dealEmployees.employeeId))
    .where(eq(employees.workspaceId, workspaceId));

  const dealIds = Array.from(new Set(assignments.map((a) => a.dealRecordId)));
  const dealInfo = await batchGetDealJobInfo(workspaceId, dealIds);

  // 3) Employee transactions for paid YTD + owed now.
  const ytdStart = startOfYear();
  const txRows = await db
    .select({
      employeeId: employeeTransactions.employeeId,
      date: employeeTransactions.date,
      amount: employeeTransactions.amount,
      amountPaid: employeeTransactions.amountPaid,
    })
    .from(employeeTransactions)
    .innerJoin(employees, eq(employees.id, employeeTransactions.employeeId))
    .where(eq(employees.workspaceId, workspaceId));

  const paidYtdByEmployee = new Map<string, number>();
  const owedNowByEmployee = new Map<string, number>();
  for (const tx of txRows) {
    const amount = Number(tx.amount);
    const paid = Number(tx.amountPaid);
    const owed = Math.max(0, amount - paid);
    if (tx.date >= ytdStart) {
      paidYtdByEmployee.set(
        tx.employeeId,
        (paidYtdByEmployee.get(tx.employeeId) ?? 0) + paid
      );
    }
    owedNowByEmployee.set(
      tx.employeeId,
      (owedNowByEmployee.get(tx.employeeId) ?? 0) + owed
    );
  }

  // 4) Bucket assignments per employee, derive dashboard metrics.
  const monthStart = startOfMonth();
  const todayIso = new Date().toISOString().slice(0, 10);

  const result: EmployeeOverviewRow[] = empRows.map((emp) => {
    const own = assignments.filter((a) => a.employeeId === emp.id);

    let jobsThisMonth = 0;
    let hoursThisMonth = 0;
    let lastJobDate: string | null = null;
    let ratingSum = 0;
    let ratingCount = 0;
    let onTimeJobCount = 0;
    let onTimeQualifyingCount = 0;

    for (const a of own) {
      const info = dealInfo.get(a.dealRecordId);
      if (!info) continue;

      const dayIso =
        info.moveDate ?? isoDay(info.scheduledStart) ?? isoDay(info.actualStart);

      // Last job = most recent move/scheduled day that is on or before today.
      if (dayIso && dayIso <= todayIso) {
        if (!lastJobDate || dayIso > lastJobDate) lastJobDate = dayIso;
      }

      // Jobs / hours this month — only count auftraege that fall in the
      // current calendar month. We use scheduledStart when present (richer
      // signal) and fall back to move_date otherwise.
      const startOfThisJob = info.scheduledStart ?? (info.moveDate ? new Date(`${info.moveDate}T00:00:00`) : null);
      if (startOfThisJob && startOfThisJob >= monthStart) {
        jobsThisMonth += 1;
        if (info.scheduledStart && info.scheduledEnd) {
          const ms = info.scheduledEnd.getTime() - info.scheduledStart.getTime();
          if (ms > 0) hoursThisMonth += ms / (1000 * 60 * 60);
        }
      }

      if (typeof info.customerRating === "number") {
        ratingSum += info.customerRating;
        ratingCount += 1;
      }

      if (info.scheduledStart && info.actualStart) {
        onTimeQualifyingCount += 1;
        const lateMs = info.actualStart.getTime() - info.scheduledStart.getTime();
        if (lateMs <= 15 * 60 * 1000) onTimeJobCount += 1;
      }
    }

    return {
      id: emp.id,
      name: emp.name,
      role: emp.role,
      status: emp.status as "active" | "on_leave" | "inactive",
      photoBase64: emp.photoBase64,
      hourlyRate: emp.hourlyRate,
      jobsThisMonth,
      hoursThisMonth: Math.round(hoursThisMonth * 10) / 10,
      paidYtd: Math.round((paidYtdByEmployee.get(emp.id) ?? 0) * 100) / 100,
      owedNow: Math.round((owedNowByEmployee.get(emp.id) ?? 0) * 100) / 100,
      avgRating:
        ratingCount > 0 ? Math.round((ratingSum / ratingCount) * 10) / 10 : null,
      ratedJobCount: ratingCount,
      onTimePct:
        onTimeQualifyingCount > 0
          ? Math.round((onTimeJobCount / onTimeQualifyingCount) * 100)
          : null,
      onTimeJobCount: onTimeQualifyingCount,
      lastJobDate,
    };
  });

  return result;
}

/**
 * Resolves the deal-side fields we need (move_date) plus the auftrag-side
 * fields (scheduled/actual start, scheduled end, customer rating) for a
 * batch of deal record IDs. Returns a map keyed by deal record id.
 *
 * Auftraege are records of the `auftraege` object linked to a deal via the
 * `deal` reference attribute (single-select, stored as record_values rows
 * with referenced_record_id pointing at the deal).
 */
async function batchGetDealJobInfo(
  workspaceId: string,
  dealIds: string[]
): Promise<Map<string, DealJobInfo>> {
  const result = new Map<string, DealJobInfo>();
  if (dealIds.length === 0) return result;

  const unique = Array.from(new Set(dealIds));

  // ── Deal side: just move_date ─────────────────────────────────────────
  const [dealObj] = await db
    .select({ id: objects.id })
    .from(objects)
    .where(and(eq(objects.workspaceId, workspaceId), eq(objects.slug, "deals")))
    .limit(1);

  let moveDateAttrId: string | null = null;
  if (dealObj) {
    const [moveDateAttr] = await db
      .select({ id: attributes.id })
      .from(attributes)
      .where(and(eq(attributes.objectId, dealObj.id), eq(attributes.slug, "move_date")))
      .limit(1);
    moveDateAttrId = moveDateAttr?.id ?? null;
  }

  const dealValueRows = moveDateAttrId
    ? await db
        .select({
          recordId: recordValues.recordId,
          dateValue: recordValues.dateValue,
        })
        .from(recordValues)
        .where(
          and(
            inArray(recordValues.recordId, unique),
            eq(recordValues.attributeId, moveDateAttrId)
          )
        )
    : [];

  for (const id of unique) {
    result.set(id, {
      moveDate: null,
      scheduledStart: null,
      scheduledEnd: null,
      actualStart: null,
      customerRating: null,
    });
  }
  for (const v of dealValueRows) {
    const cur = result.get(v.recordId);
    if (cur) cur.moveDate = v.dateValue ?? null;
  }

  // ── Auftrag side: time_window_start/end, actual_start, customer_rating ─
  const [auftragObj] = await db
    .select({ id: objects.id })
    .from(objects)
    .where(
      and(eq(objects.workspaceId, workspaceId), eq(objects.slug, "auftraege"))
    )
    .limit(1);
  if (!auftragObj) return result;

  const auftragAttrs = await db
    .select()
    .from(attributes)
    .where(
      and(
        eq(attributes.objectId, auftragObj.id),
        inArray(attributes.slug, [
          "deal",
          "time_window_start",
          "time_window_end",
          "actual_start",
          "customer_rating",
        ])
      )
    );
  const attrBySlug = new Map(auftragAttrs.map((a) => [a.slug, a]));
  const dealAttr = attrBySlug.get("deal");
  if (!dealAttr) return result;

  // Find all auftrag record IDs whose `deal` reference points to one of our deals.
  const auftragLinkRows = await db
    .select({
      auftragRecordId: recordValues.recordId,
      dealRecordId: recordValues.referencedRecordId,
    })
    .from(recordValues)
    .where(
      and(
        eq(recordValues.attributeId, dealAttr.id),
        inArray(recordValues.referencedRecordId, unique)
      )
    );
  if (auftragLinkRows.length === 0) return result;

  const auftragIds = Array.from(
    new Set(auftragLinkRows.map((r) => r.auftragRecordId))
  );
  const auftragByRecord = new Map<string, string>();
  for (const r of auftragLinkRows) {
    if (r.dealRecordId) auftragByRecord.set(r.auftragRecordId, r.dealRecordId);
  }

  // Pull the four interesting attribute values for those auftraege.
  const wantedAttrIds = ["time_window_start", "time_window_end", "actual_start", "customer_rating"]
    .map((slug) => attrBySlug.get(slug)?.id)
    .filter((x): x is string => Boolean(x));

  const auftragValueRows = wantedAttrIds.length
    ? await db
        .select({
          recordId: recordValues.recordId,
          attributeId: recordValues.attributeId,
          timestampValue: recordValues.timestampValue,
          numberValue: recordValues.numberValue,
        })
        .from(recordValues)
        .where(
          and(
            inArray(recordValues.recordId, auftragIds),
            inArray(recordValues.attributeId, wantedAttrIds)
          )
        )
    : [];

  const startAttrId = attrBySlug.get("time_window_start")?.id ?? null;
  const endAttrId = attrBySlug.get("time_window_end")?.id ?? null;
  const actualStartAttrId = attrBySlug.get("actual_start")?.id ?? null;
  const ratingAttrId = attrBySlug.get("customer_rating")?.id ?? null;

  // For each auftrag, resolve its values then fold them onto its deal record.
  const byAuftrag = new Map<
    string,
    { start: Date | null; end: Date | null; actual: Date | null; rating: number | null }
  >();
  for (const r of auftragValueRows) {
    let bucket = byAuftrag.get(r.recordId);
    if (!bucket) {
      bucket = { start: null, end: null, actual: null, rating: null };
      byAuftrag.set(r.recordId, bucket);
    }
    if (r.attributeId === startAttrId) bucket.start = r.timestampValue ?? null;
    else if (r.attributeId === endAttrId) bucket.end = r.timestampValue ?? null;
    else if (r.attributeId === actualStartAttrId) bucket.actual = r.timestampValue ?? null;
    else if (r.attributeId === ratingAttrId) {
      bucket.rating = r.numberValue !== null ? Number(r.numberValue) : null;
    }
  }

  // Multiple auftraege per deal: keep the most recent scheduled_start as the
  // representative "job" for last-job/this-month buckets, and aggregate the
  // rating + on-time evidence across all of them.
  for (const [auftragId, vals] of byAuftrag.entries()) {
    const dealId = auftragByRecord.get(auftragId);
    if (!dealId) continue;
    const cur = result.get(dealId);
    if (!cur) continue;

    if (vals.start) {
      if (!cur.scheduledStart || vals.start > cur.scheduledStart) {
        cur.scheduledStart = vals.start;
        cur.scheduledEnd = vals.end;
        cur.actualStart = vals.actual;
      }
    }

    if (typeof vals.rating === "number" && cur.customerRating === null) {
      cur.customerRating = vals.rating;
    }
  }

  return result;
}

/**
 * Monthly paid-vs-owed buckets for the drill-down chart.
 *
 * Buckets are based on the transaction `date` (when the obligation was
 * recorded). `paid` is the running amount_paid for that month; `owed` is
 * the unpaid remainder of obligations recorded that month, captured at
 * read time.
 */
export interface EmployeeMonthlyBucket {
  month: string; // YYYY-MM
  paid: number;
  owed: number;
}

export async function getEmployeeMonthlyBuckets(
  workspaceId: string,
  employeeId: string,
  monthsBack: number = 12
): Promise<EmployeeMonthlyBucket[]> {
  const cutoff = new Date();
  cutoff.setDate(1);
  cutoff.setHours(0, 0, 0, 0);
  cutoff.setMonth(cutoff.getMonth() - (monthsBack - 1));
  const cutoffIso = cutoff.toISOString().slice(0, 10);

  const txRows = await db
    .select({
      date: employeeTransactions.date,
      amount: employeeTransactions.amount,
      amountPaid: employeeTransactions.amountPaid,
    })
    .from(employeeTransactions)
    .innerJoin(employees, eq(employees.id, employeeTransactions.employeeId))
    .where(
      and(
        eq(employees.workspaceId, workspaceId),
        eq(employeeTransactions.employeeId, employeeId),
        sql`${employeeTransactions.date} >= ${cutoffIso}`
      )
    );

  const buckets = new Map<string, { paid: number; owed: number }>();
  for (let i = 0; i < monthsBack; i++) {
    const d = new Date(cutoff);
    d.setMonth(cutoff.getMonth() + i);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    buckets.set(key, { paid: 0, owed: 0 });
  }

  for (const tx of txRows) {
    const key = tx.date.slice(0, 7);
    const b = buckets.get(key);
    if (!b) continue;
    const amount = Number(tx.amount);
    const paid = Number(tx.amountPaid);
    b.paid += paid;
    b.owed += Math.max(0, amount - paid);
  }

  return Array.from(buckets.entries()).map(([month, v]) => ({
    month,
    paid: Math.round(v.paid * 100) / 100,
    owed: Math.round(v.owed * 100) / 100,
  }));
}
