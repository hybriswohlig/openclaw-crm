import { db } from "@/db";
import { employees, dealEmployees, employeeTransactions, dealNumbers, records, recordValues, attributes, objects, statuses } from "@/db/schema";
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

  return rows;
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

// ─── Rich detail (Aufträge / Zahlungen / Auslagen) ──────────────────────────

export type EmployeeTransactionStatusComputed = "offen" | "teilweise bezahlt" | "bezahlt";

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

export interface EmployeeTransactionRow {
  id: string;
  date: string;
  type: "salary" | "advance" | "reimbursement";
  amount: number;
  amountPaid: number;
  amountOutstanding: number;
  status: EmployeeTransactionStatusComputed;
  dueDate: string | null;
  description: string | null;
  notes: string | null;
  dealRecordId: string;
  dealNumber: string | null;
  dealName: string;
}

export interface EmployeeDetailExtras {
  auftraege: EmployeeAuftrag[];
  paymentsReceived: EmployeeTransactionRow[];
  outOfPocket: EmployeeTransactionRow[];
  totals: {
    receivedTotal: number;
    outstandingTotal: number;
    outOfPocketOpen: number;
  };
}

function computeStatus(amount: number, amountPaid: number): EmployeeTransactionStatusComputed {
  if (amountPaid <= 0) return "offen";
  if (amountPaid + 0.005 < amount) return "teilweise bezahlt";
  return "bezahlt";
}

export async function getEmployeeDetailExtras(
  workspaceId: string,
  employeeId: string
): Promise<EmployeeDetailExtras | null> {
  const existing = await getEmployee(workspaceId, employeeId);
  if (!existing) return null;

  // 1) All deal_employees rows for this employee
  const assignments = await db
    .select()
    .from(dealEmployees)
    .where(eq(dealEmployees.employeeId, employeeId))
    .orderBy(desc(dealEmployees.createdAt));

  // 2) All employee_transactions for this employee
  const txRows = await db
    .select()
    .from(employeeTransactions)
    .where(eq(employeeTransactions.employeeId, employeeId))
    .orderBy(desc(employeeTransactions.date));

  // Collect all involved deal IDs to batch-resolve names + numbers + stage
  const dealIds = Array.from(
    new Set([...assignments.map((a) => a.dealRecordId), ...txRows.map((t) => t.dealRecordId)])
  );

  const dealInfo = await batchGetDealOpsInfo(workspaceId, dealIds);

  // 3) Aufträge list
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

  // 4) Build typed transaction rows with computed status
  const enriched: EmployeeTransactionRow[] = txRows.map((t) => {
    const info = dealInfo.get(t.dealRecordId);
    const amount = Number(t.amount);
    const amountPaid = Number(t.amountPaid);
    return {
      id: t.id,
      date: t.date,
      type: t.type as "salary" | "advance" | "reimbursement",
      amount,
      amountPaid,
      amountOutstanding: Math.max(0, amount - amountPaid),
      status: computeStatus(amount, amountPaid),
      dueDate: t.dueDate ?? null,
      description: t.description,
      notes: t.notes,
      dealRecordId: t.dealRecordId,
      dealNumber: info?.dealNumber ?? null,
      dealName: info?.name ?? "(Deal gelöscht)",
    };
  });

  // 5) Split into payments-received vs out-of-pocket
  // Payments received = salary + advance, plus reimbursement *paid back to them* (any amountPaid > 0).
  //   - For reimbursements we still also list them under "Auslagen" so user can see status.
  const paymentsReceived = enriched.filter(
    (t) => t.type === "salary" || t.type === "advance" || (t.type === "reimbursement" && t.amountPaid > 0)
  );
  // Out-of-pocket = ALL reimbursement rows, regardless of paid status (status badge distinguishes).
  const outOfPocket = enriched.filter((t) => t.type === "reimbursement");

  const receivedTotal = paymentsReceived.reduce((sum, t) => sum + t.amountPaid, 0);
  const outstandingTotal = enriched.reduce((sum, t) => sum + t.amountOutstanding, 0);
  const outOfPocketOpen = outOfPocket.reduce((sum, t) => sum + t.amountOutstanding, 0);

  return {
    auftraege,
    paymentsReceived,
    outOfPocket,
    totals: { receivedTotal, outstandingTotal, outOfPocketOpen },
  };
}

interface DealOpsInfo {
  name: string;
  dealNumber: string | null;
  stage: { title: string; color: string } | null;
  moveDate: string | null;
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
    .where(and(eq(attributes.objectId, dealObj.id), inArray(attributes.slug, ["name", "stage", "move_date"])));
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

  for (const id of unique) {
    if (!presentSet.has(id)) continue;
    const vals = dealValueMap.get(id);
    const stageId = stageAttr ? vals?.get(stageAttr.id)?.textValue ?? null : null;
    result.set(id, {
      name: nameAttrId ? vals?.get(nameAttrId)?.textValue ?? "Unbenannt" : "Unbenannt",
      dealNumber: numByDeal.get(id) ?? null,
      stage: stageId ? stageMap.get(stageId) ?? null : null,
      moveDate: moveDateAttrId ? vals?.get(moveDateAttrId)?.dateValue ?? null : null,
    });
  }

  return result;
}
