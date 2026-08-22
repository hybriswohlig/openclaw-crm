// Project budget (spec §4.6). projects.budget_planned_cents is the FRAME
// (the KPI denominator); kind='ist' rows sum to the spend; kind='plan' rows
// are the optional breakdown of the frame and never count as spend.
// Money is always integer cents, currency is fixed EUR.

import { db } from "@/db";
import { projectBudgetEntries, projects } from "@/db/schema";
import { and, asc, eq } from "drizzle-orm";
import { normalizeBudgetEntryKind, type BudgetEntryKind } from "@/lib/project-constants";
import { budgetPct, parseDateColumn } from "@/lib/work-metrics";

/** Same validator as the read path uses to parse — they cannot disagree. */
function isDayString(v: string): boolean {
  return parseDateColumn(v) !== null;
}
import { recordProjectEvent } from "./activity-events";

export interface BudgetEntryData {
  id: string;
  projectId: string;
  label: string;
  amountCents: number;
  kind: BudgetEntryKind;
  bookedAt: Date | null;
  note: string | null;
  createdBy: string | null;
  createdAt: Date;
}

export interface BudgetSummary {
  plannedCents: number | null;
  spentCents: number;
  plannedBreakdownCents: number;
  pct: number | null;
  entries: BudgetEntryData[];
}

export interface BudgetWriteValues {
  label: string;
  amountCents: number;
  kind: BudgetEntryKind;
  bookedAt: string | null;
  note: string | null;
}

function str(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length > 0 ? t : null;
}

/** Pure: the whole budget KPI from the frame plus the register rows. */
export function summarizeBudget(
  plannedCents: number | null,
  entries: BudgetEntryData[],
): BudgetSummary {
  let spentCents = 0;
  let plannedBreakdownCents = 0;
  for (const e of entries) {
    if (e.kind === "ist") spentCents += e.amountCents;
    else plannedBreakdownCents += e.amountCents;
  }
  return {
    plannedCents,
    spentCents,
    plannedBreakdownCents,
    pct: budgetPct(spentCents, plannedCents),
    entries,
  };
}

export function resolveBudgetEntryCreate(
  input: unknown,
): { ok: true; values: BudgetWriteValues } | { ok: false; error: string } {
  const body = (input ?? {}) as Record<string, unknown>;
  const label = str(body.label);
  if (!label) return { ok: false, error: "Bezeichnung ist erforderlich." };
  if (typeof body.amountCents !== "number" || !Number.isInteger(body.amountCents)) {
    return { ok: false, error: "Betrag muss eine ganze Zahl in Cent sein." };
  }
  const kind = normalizeBudgetEntryKind(body.kind);
  if (!kind) return { ok: false, error: "Ungültige Budget-Art." };
  const bookedAt = str(body.bookedAt);
  if (bookedAt && !isDayString(bookedAt)) return { ok: false, error: "Datum muss im Format JJJJ-MM-TT angegeben werden." };
  return {
    ok: true,
    values: { label, amountCents: body.amountCents, kind, bookedAt, note: str(body.note) },
  };
}

export function resolveBudgetEntryUpdate(
  updates: unknown,
): { ok: true; set: Record<string, unknown> } | { ok: false; error: string } {
  const body = (updates ?? {}) as Record<string, unknown>;
  const has = (k: string) => Object.prototype.hasOwnProperty.call(body, k);
  const set: Record<string, unknown> = {};

  if (has("label")) {
    const label = str(body.label);
    if (!label) return { ok: false, error: "Bezeichnung darf nicht leer sein." };
    set.label = label;
  }
  if (has("amountCents")) {
    if (typeof body.amountCents !== "number" || !Number.isInteger(body.amountCents)) {
      return { ok: false, error: "Betrag muss eine ganze Zahl in Cent sein." };
    }
    set.amountCents = body.amountCents;
  }
  if (has("kind")) {
    const kind = normalizeBudgetEntryKind(body.kind);
    if (!kind) return { ok: false, error: "Ungültige Budget-Art." };
    set.kind = kind;
  }
  if (has("bookedAt")) {
    const bookedAt = str(body.bookedAt);
    if (bookedAt && !isDayString(bookedAt)) return { ok: false, error: "Datum muss im Format JJJJ-MM-TT angegeben werden." };
    set.bookedAt = bookedAt;
  }
  if (has("note")) set.note = str(body.note);
  return { ok: true, set };
}

function toEntryData(row: typeof projectBudgetEntries.$inferSelect): BudgetEntryData {
  return {
    id: row.id,
    projectId: row.projectId,
    label: row.label,
    amountCents: row.amountCents,
    kind: normalizeBudgetEntryKind(row.kind) ?? "ist",
    // booked_at is a `date` column in string mode ("YYYY-MM-DD").
    bookedAt: parseDateColumn(row.bookedAt),
    note: row.note,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
  };
}

export async function getBudget(
  workspaceId: string,
  projectId: string,
): Promise<BudgetSummary | null> {
  const [project] = await db
    .select({ budgetPlannedCents: projects.budgetPlannedCents })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.workspaceId, workspaceId)))
    .limit(1);
  if (!project) return null;

  const rows = await db
    .select()
    .from(projectBudgetEntries)
    .where(
      and(
        eq(projectBudgetEntries.workspaceId, workspaceId),
        eq(projectBudgetEntries.projectId, projectId),
      ),
    )
    .orderBy(asc(projectBudgetEntries.createdAt));

  return summarizeBudget(project.budgetPlannedCents, rows.map(toEntryData));
}

export async function createBudgetEntry(
  workspaceId: string,
  projectId: string,
  createdBy: string,
  input: {
    label: string;
    amountCents: number;
    kind: string;
    bookedAt?: string | null;
    note?: string | null;
  },
): Promise<BudgetEntryData | null> {
  const [project] = await db
    .select({ id: projects.id, name: projects.name })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.workspaceId, workspaceId)))
    .limit(1);
  if (!project) return null;

  const parsed = resolveBudgetEntryCreate(input);
  if (!parsed.ok) throw new Error(parsed.error);

  const [row] = await db
    .insert(projectBudgetEntries)
    .values({
      workspaceId,
      projectId,
      createdBy,
      label: parsed.values.label,
      amountCents: parsed.values.amountCents,
      kind: parsed.values.kind,
      // `date` column in string mode — the "YYYY-MM-DD" string goes in
      // unconverted. Was `new Date(...)` before Phase 1 shipped string mode.
      bookedAt: parsed.values.bookedAt,
      note: parsed.values.note,
    })
    .returning();

  const entry = toEntryData(row);
  // Not a §10.2 notification trigger → activity row only.
  await recordProjectEvent({
    workspaceId,
    projectId,
    projectName: project.name,
    eventType: "project.budget_entry_added",
    actorId: createdBy,
    title: "Budgetposten erfasst",
    body: `${project.name}: ${entry.label}`,
    payload: { entryId: entry.id, amountCents: entry.amountCents, kind: entry.kind },
  });
  return entry;
}

export async function updateBudgetEntry(
  workspaceId: string,
  entryId: string,
  updates: Partial<{
    label: string;
    amountCents: number;
    kind: string;
    bookedAt: string | null;
    note: string | null;
  }>,
): Promise<BudgetEntryData | null> {
  const [existing] = await db
    .select({ id: projectBudgetEntries.id })
    .from(projectBudgetEntries)
    .where(
      and(
        eq(projectBudgetEntries.id, entryId),
        eq(projectBudgetEntries.workspaceId, workspaceId),
      ),
    )
    .limit(1);
  if (!existing) return null;

  const parsed = resolveBudgetEntryUpdate(updates);
  if (!parsed.ok) throw new Error(parsed.error);

  // No date conversion on the way in: resolveBudgetEntryUpdate already
  // produced a "YYYY-MM-DD" string (or null) for the `date` column.
  const set = parsed.set;

  if (Object.keys(set).length > 0) {
    await db.update(projectBudgetEntries).set(set).where(eq(projectBudgetEntries.id, entryId));
  }

  const [row] = await db
    .select()
    .from(projectBudgetEntries)
    .where(eq(projectBudgetEntries.id, entryId))
    .limit(1);
  return row ? toEntryData(row) : null;
}

export async function deleteBudgetEntry(
  workspaceId: string,
  entryId: string,
): Promise<boolean> {
  const deleted = await db
    .delete(projectBudgetEntries)
    .where(
      and(
        eq(projectBudgetEntries.id, entryId),
        eq(projectBudgetEntries.workspaceId, workspaceId),
      ),
    )
    .returning({ id: projectBudgetEntries.id });
  return deleted.length > 0;
}
