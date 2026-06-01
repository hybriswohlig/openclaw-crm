import { db } from "@/db";
import { employees, dealEmployees, employeeLedger, dealNumbers, records, recordValues, attributes, objects, statuses } from "@/db/schema";
import { eq, and, sql, inArray, desc } from "drizzle-orm";

export async function listEmployees(workspaceId: string) {
  const rows = await db
    .select({
      id: employees.id,
      name: employees.name,
      experience: employees.experience,
      hourlyRate: employees.hourlyRate,
      photoBase64: employees.photoBase64,
      createdAt: employees.createdAt,
      updatedAt: employees.updatedAt,
      contractCount: sql<number>`(
        SELECT count(*)::int FROM deal_employees WHERE deal_employees.employee_id = ${employees.id}
      )`,
    })
    .from(employees)
    .where(eq(employees.workspaceId, workspaceId))
    .orderBy(employees.name);

  // Saldo (earned − paid) je Mitarbeiter dazumischen.
  const saldos = await listEmployeeSaldos(workspaceId);
  return rows.map((r) => ({ ...r, saldoTotal: saldos.get(r.id) ?? 0 }));
}

export async function getEmployee(workspaceId: string, employeeId: string) {
  const [row] = await db
    .select()
    .from(employees)
    .where(and(eq(employees.id, employeeId), eq(employees.workspaceId, workspaceId)))
    .limit(1);
  return row ?? null;
}

export async function createEmployee(
  workspaceId: string,
  input: { name: string; experience?: string; hourlyRate: string; photoBase64?: string | null }
) {
  const [row] = await db
    .insert(employees)
    .values({
      workspaceId,
      name: input.name,
      experience: input.experience ?? null,
      hourlyRate: input.hourlyRate,
      photoBase64: input.photoBase64 ?? null,
    })
    .returning();
  return row;
}

export async function updateEmployee(
  workspaceId: string,
  employeeId: string,
  input: { name?: string; experience?: string; hourlyRate?: string; photoBase64?: string | null }
) {
  const existing = await getEmployee(workspaceId, employeeId);
  if (!existing) return null;

  const [updated] = await db
    .update(employees)
    .set({
      ...(input.name !== undefined && { name: input.name }),
      ...(input.experience !== undefined && { experience: input.experience }),
      ...(input.hourlyRate !== undefined && { hourlyRate: input.hourlyRate }),
      ...(input.photoBase64 !== undefined && { photoBase64: input.photoBase64 }),
      updatedAt: new Date(),
    })
    .where(eq(employees.id, employeeId))
    .returning();
  return updated;
}

export async function deleteEmployee(workspaceId: string, employeeId: string) {
  const existing = await getEmployee(workspaceId, employeeId);
  if (!existing) return null;

  await db.delete(employees).where(eq(employees.id, employeeId));
  return existing;
}

export async function listDealEmployees(dealRecordId: string) {
  return db
    .select({
      id: dealEmployees.id,
      employeeId: dealEmployees.employeeId,
      role: dealEmployees.role,
      createdAt: dealEmployees.createdAt,
      employeeName: employees.name,
      hourlyRate: employees.hourlyRate,
      experience: employees.experience,
    })
    .from(dealEmployees)
    .innerJoin(employees, eq(employees.id, dealEmployees.employeeId))
    .where(eq(dealEmployees.dealRecordId, dealRecordId))
    .orderBy(dealEmployees.createdAt);
}

export async function assignEmployeeToDeal(
  dealRecordId: string,
  employeeId: string,
  role: string = "helper"
) {
  const [row] = await db
    .insert(dealEmployees)
    .values({ dealRecordId, employeeId, role })
    .returning();
  return row;
}

export async function unassignEmployeeFromDeal(assignmentId: string) {
  const [row] = await db
    .select()
    .from(dealEmployees)
    .where(eq(dealEmployees.id, assignmentId))
    .limit(1);
  if (!row) return null;

  await db.delete(dealEmployees).where(eq(dealEmployees.id, assignmentId));
  return row;
}

export async function getEmployeeContracts(workspaceId: string, employeeId: string) {
  const existing = await getEmployee(workspaceId, employeeId);
  if (!existing) return null;

  return db
    .select({
      assignmentId: dealEmployees.id,
      dealRecordId: dealEmployees.dealRecordId,
      role: dealEmployees.role,
      assignedAt: dealEmployees.createdAt,
    })
    .from(dealEmployees)
    .where(eq(dealEmployees.employeeId, employeeId))
    .orderBy(dealEmployees.createdAt);
}

// ─── Rich detail (Saldo / Buchungsverlauf / Aufträge) ───────────────────────

export interface EmployeeAuftrag {
  assignmentId: string;
  dealRecordId: string;
  dealNumber: string | null;
  dealName: string;
  stage: { title: string; color: string } | null;
  moveDate: string | null;
  role: string;
  assignedAt: Date;
}

export interface EmployeeLedgerRow {
  id: string;
  date: string;
  kind: "earning" | "reimbursement" | "payment";
  /** Always positive. */
  amount: number;
  /** + for credit (earning/reimbursement), − for payment. */
  signedAmount: number;
  operatingCompanyId: string | null;
  operatingCompanyName: string;
  payingOperatingCompanyId: string | null;
  payingOperatingCompanyName: string | null;
  /** True when a different company paid/bears this entry (Quersubvention). */
  isCrossSubsidy: boolean;
  dealRecordId: string | null;
  dealNumber: string | null;
  dealName: string | null;
  paymentMethod: string | null;
  description: string | null;
  notes: string | null;
  isTaxDeductible: boolean;
  hasReceipt: boolean;
  dueDate: string | null;
}

export interface EmployeeCompanySaldo {
  companyId: string | null;
  companyName: string;
  earned: number;
  paid: number;
  /** earned − paid = was wir dieser Firma-Zuordnung noch schulden. */
  balance: number;
}

export interface EmployeeDetailExtras {
  auftraege: EmployeeAuftrag[];
  ledger: EmployeeLedgerRow[];
  /** Saldo gesamt (firmenübergreifend) = was wir dem Mitarbeiter schulden. */
  saldoTotal: number;
  saldoByCompany: EmployeeCompanySaldo[];
  totals: {
    earnedTotal: number;
    paidTotal: number;
    /** Offene Erstattungen (Belege), die noch nicht im Saldo beglichen sind — informativ. */
    reimbursementTotal: number;
    receiptCount: number;
  };
}

export async function getEmployeeDetailExtras(
  workspaceId: string,
  employeeId: string
): Promise<EmployeeDetailExtras | null> {
  const existing = await getEmployee(workspaceId, employeeId);
  if (!existing) return null;

  // 1) Auftrags-Zuweisungen
  const assignments = await db
    .select()
    .from(dealEmployees)
    .where(eq(dealEmployees.employeeId, employeeId))
    .orderBy(desc(dealEmployees.createdAt));

  // 2) Alle Ledger-Buchungen
  const rows = await db
    .select()
    .from(employeeLedger)
    .where(eq(employeeLedger.employeeId, employeeId))
    .orderBy(desc(employeeLedger.date), desc(employeeLedger.createdAt));

  // Deal-Infos (Name/Nummer/Stage/Datum + Firma) für alle beteiligten Deals
  const dealIds = Array.from(
    new Set(
      [
        ...assignments.map((a) => a.dealRecordId),
        ...rows.map((r) => r.dealRecordId),
      ].filter((id): id is string => !!id)
    )
  );
  const dealInfo = await batchGetDealOpsInfo(workspaceId, dealIds);

  // Firmen-Namen für alle berührten Firmen-IDs (Deal-Firma + operating/paying)
  const companyIds = new Set<string>();
  for (const info of dealInfo.values())
    if (info.operatingCompanyId) companyIds.add(info.operatingCompanyId);
  for (const r of rows) {
    if (r.operatingCompanyId) companyIds.add(r.operatingCompanyId);
    if (r.payingOperatingCompanyId) companyIds.add(r.payingOperatingCompanyId);
  }
  const companyNames = await resolveCompanyNames(workspaceId, [...companyIds]);

  const auftraege: EmployeeAuftrag[] = assignments.map((a) => {
    const info = dealInfo.get(a.dealRecordId);
    return {
      assignmentId: a.id,
      dealRecordId: a.dealRecordId,
      dealNumber: info?.dealNumber ?? null,
      dealName: info?.name ?? "(Deal gelöscht)",
      stage: info?.stage ?? null,
      moveDate: info?.moveDate ?? null,
      role: a.role,
      assignedAt: a.createdAt,
    };
  });

  /** Resolve the company a ledger row belongs to: deal's live company if linked, else stored. */
  const resolveCompany = (r: (typeof rows)[number]): string | null =>
    r.dealRecordId
      ? dealInfo.get(r.dealRecordId)?.operatingCompanyId ?? null
      : r.operatingCompanyId ?? null;

  const ledger: EmployeeLedgerRow[] = rows.map((r) => {
    const info = r.dealRecordId ? dealInfo.get(r.dealRecordId) : undefined;
    const ownCompany = resolveCompany(r);
    const amount = Number(r.amount);
    const isCredit = r.kind === "earning" || r.kind === "reimbursement";
    const isCross =
      r.payingOperatingCompanyId != null &&
      ownCompany != null &&
      r.payingOperatingCompanyId !== ownCompany;
    return {
      id: r.id,
      date: r.date,
      kind: r.kind as EmployeeLedgerRow["kind"],
      amount,
      signedAmount: isCredit ? amount : -amount,
      operatingCompanyId: ownCompany,
      operatingCompanyName: ownCompany
        ? companyNames.get(ownCompany) ?? "Unbekannt"
        : "—",
      payingOperatingCompanyId: r.payingOperatingCompanyId ?? null,
      payingOperatingCompanyName: r.payingOperatingCompanyId
        ? companyNames.get(r.payingOperatingCompanyId) ?? "Unbekannt"
        : null,
      isCrossSubsidy: isCross,
      dealRecordId: r.dealRecordId ?? null,
      dealNumber: info?.dealNumber ?? null,
      dealName: r.dealRecordId ? info?.name ?? "(Deal gelöscht)" : null,
      paymentMethod: r.paymentMethod,
      description: r.description,
      notes: r.notes,
      isTaxDeductible: r.isTaxDeductible,
      hasReceipt: !!r.receiptFile,
      dueDate: r.dueDate ?? null,
    };
  });

  // Saldo pro Firma (earned − paid), companyId null = "Nicht zugewiesen"
  const UNASSIGNED = "__unassigned__";
  const byCompany = new Map<
    string,
    { companyId: string | null; earned: number; paid: number }
  >();
  for (const row of ledger) {
    const key = row.operatingCompanyId ?? UNASSIGNED;
    let agg = byCompany.get(key);
    if (!agg) {
      agg = { companyId: row.operatingCompanyId, earned: 0, paid: 0 };
      byCompany.set(key, agg);
    }
    if (row.kind === "payment") agg.paid += row.amount;
    else agg.earned += row.amount;
  }

  const saldoByCompany: EmployeeCompanySaldo[] = [...byCompany.values()]
    .map((a) => ({
      companyId: a.companyId,
      companyName:
        a.companyId === null
          ? "Nicht zugewiesen"
          : companyNames.get(a.companyId) ?? "Unbekannt",
      earned: a.earned,
      paid: a.paid,
      balance: a.earned - a.paid,
    }))
    .sort((a, b) => b.balance - a.balance);

  const earnedTotal = ledger
    .filter((r) => r.kind !== "payment")
    .reduce((s, r) => s + r.amount, 0);
  const paidTotal = ledger
    .filter((r) => r.kind === "payment")
    .reduce((s, r) => s + r.amount, 0);
  const reimbursementTotal = ledger
    .filter((r) => r.kind === "reimbursement")
    .reduce((s, r) => s + r.amount, 0);
  const receiptCount = ledger.filter((r) => r.hasReceipt).length;

  return {
    auftraege,
    ledger,
    saldoTotal: earnedTotal - paidTotal,
    saldoByCompany,
    totals: {
      earnedTotal,
      paidTotal,
      reimbursementTotal,
      receiptCount,
    },
  };
}

/** Resolve operating-company display names for a set of record ids. */
async function resolveCompanyNames(
  workspaceId: string,
  ids: string[]
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (ids.length === 0) return map;
  const [nameAttr] = await db
    .select({ id: attributes.id })
    .from(attributes)
    .innerJoin(objects, eq(objects.id, attributes.objectId))
    .where(
      and(
        eq(objects.workspaceId, workspaceId),
        eq(objects.slug, "operating_companies"),
        eq(attributes.slug, "name")
      )
    )
    .limit(1);
  if (!nameAttr) return map;
  const nameRows = await db
    .select({ recordId: recordValues.recordId, name: recordValues.textValue })
    .from(recordValues)
    .where(
      and(
        eq(recordValues.attributeId, nameAttr.id),
        inArray(recordValues.recordId, ids)
      )
    );
  for (const r of nameRows) map.set(r.recordId, r.name ?? "Unbekannt");
  return map;
}

interface DealOpsInfo {
  name: string;
  dealNumber: string | null;
  stage: { title: string; color: string } | null;
  moveDate: string | null;
  operatingCompanyId: string | null;
}

async function batchGetDealOpsInfo(
  workspaceId: string,
  dealIds: string[]
): Promise<Map<string, DealOpsInfo>> {
  const result = new Map<string, DealOpsInfo>();
  if (dealIds.length === 0) return result;

  const unique = Array.from(new Set(dealIds));

  // Resolve deals object + key attribute IDs
  const [dealObj] = await db
    .select({ id: objects.id })
    .from(objects)
    .where(and(eq(objects.workspaceId, workspaceId), eq(objects.slug, "deals")))
    .limit(1);
  if (!dealObj) return result;

  const attrRows = await db
    .select()
    .from(attributes)
    .where(and(eq(attributes.objectId, dealObj.id), inArray(attributes.slug, ["name", "stage", "move_date", "operating_company"])));
  const attrBySlug = new Map(attrRows.map((a) => [a.slug, a]));

  const stageAttr = attrBySlug.get("stage");
  let stageMap = new Map<string, { title: string; color: string }>();
  if (stageAttr) {
    const stageRows = await db
      .select()
      .from(statuses)
      .where(eq(statuses.attributeId, stageAttr.id));
    stageMap = new Map(stageRows.map((s) => [s.id, { title: s.title, color: s.color }]));
  }

  const interestedAttrIds = attrRows.map((a) => a.id);
  const valueRows = interestedAttrIds.length
    ? await db
        .select()
        .from(recordValues)
        .where(and(inArray(recordValues.recordId, unique), inArray(recordValues.attributeId, interestedAttrIds)))
    : [];

  const dealValueMap = new Map<string, Map<string, typeof valueRows[number]>>();
  for (const v of valueRows) {
    let m = dealValueMap.get(v.recordId);
    if (!m) {
      m = new Map();
      dealValueMap.set(v.recordId, m);
    }
    m.set(v.attributeId, v);
  }

  const numbers = await db
    .select()
    .from(dealNumbers)
    .where(inArray(dealNumbers.dealRecordId, unique));
  const numByDeal = new Map(numbers.map((n) => [n.dealRecordId, n.dealNumber]));

  // Make sure we still mark deals that exist as `records` rows even if they have no values.
  const presentDealIds = await db
    .select({ id: records.id })
    .from(records)
    .where(and(eq(records.objectId, dealObj.id), inArray(records.id, unique)));
  const presentSet = new Set(presentDealIds.map((d) => d.id));

  const nameAttrId = attrBySlug.get("name")?.id ?? null;
  const moveDateAttrId = attrBySlug.get("move_date")?.id ?? null;
  const ocAttrId = attrBySlug.get("operating_company")?.id ?? null;

  for (const id of unique) {
    if (!presentSet.has(id)) continue;
    const vals = dealValueMap.get(id);
    const stageId = stageAttr ? vals?.get(stageAttr.id)?.textValue ?? null : null;
    result.set(id, {
      name: nameAttrId ? vals?.get(nameAttrId)?.textValue ?? "Unbenannt" : "Unbenannt",
      dealNumber: numByDeal.get(id) ?? null,
      stage: stageId ? stageMap.get(stageId) ?? null : null,
      moveDate: moveDateAttrId ? vals?.get(moveDateAttrId)?.dateValue ?? null : null,
      operatingCompanyId: ocAttrId ? vals?.get(ocAttrId)?.referencedRecordId ?? null : null,
    });
  }

  return result;
}

// ─── Workspace-weite Mitarbeiter-Salden (Übersichtsliste) ───────────────────

export interface EmployeeSaldoSummary {
  employeeId: string;
  saldoTotal: number;
}

/**
 * Saldo (earned − paid) je Mitarbeiter für den ganzen Workspace — für die
 * Übersichtstabelle. Eine Query, gruppiert in JS.
 */
export async function listEmployeeSaldos(
  workspaceId: string
): Promise<Map<string, number>> {
  const rows = await db
    .select({
      employeeId: employeeLedger.employeeId,
      kind: employeeLedger.kind,
      amount: employeeLedger.amount,
    })
    .from(employeeLedger)
    .where(eq(employeeLedger.workspaceId, workspaceId));
  const map = new Map<string, number>();
  for (const r of rows) {
    const delta = r.kind === "payment" ? -Number(r.amount) : Number(r.amount);
    map.set(r.employeeId, (map.get(r.employeeId) ?? 0) + delta);
  }
  return map;
}
