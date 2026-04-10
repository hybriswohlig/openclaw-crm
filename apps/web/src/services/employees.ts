import { db } from "@/db";
import { employees, dealEmployees } from "@/db/schema";
import { eq, and, sql } from "drizzle-orm";

export async function listEmployees(workspaceId: string) {
  const rows = await db
    .select({
      id: employees.id,
      name: employees.name,
      experience: employees.experience,
      hourlyRate: employees.hourlyRate,
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
  input: { name: string; experience?: string; hourlyRate: string }
) {
  const [row] = await db
    .insert(employees)
    .values({
      workspaceId,
      name: input.name,
      experience: input.experience ?? null,
      hourlyRate: input.hourlyRate,
    })
    .returning();
  return row;
}

export async function updateEmployee(
  workspaceId: string,
  employeeId: string,
  input: { name?: string; experience?: string; hourlyRate?: string }
) {
  const existing = await getEmployee(workspaceId, employeeId);
  if (!existing) return null;

  const [updated] = await db
    .update(employees)
    .set({
      ...(input.name !== undefined && { name: input.name }),
      ...(input.experience !== undefined && { experience: input.experience }),
      ...(input.hourlyRate !== undefined && { hourlyRate: input.hourlyRate }),
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
