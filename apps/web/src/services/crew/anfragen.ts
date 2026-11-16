/**
 * Antworten aus dem Crew-Portal für den Einsatz-Dialog: wer „ja“,
 * „warteliste“, „vielleicht“ oder „nein“ gesagt hat. Schon eingeteilte
 * Personen fehlen (für sie gilt deal_employees). Nur für Inhaber.
 */
import { and, eq, notInArray, asc } from "drizzle-orm";
import { db } from "@/db";
import { crewJobResponses, dealEmployees, employees } from "@/db/schema";
import type { EinsatzAnfrage } from "@/lib/einsatz-ansicht";

export async function crewAnfragenLesen(ws: string, deal: string): Promise<EinsatzAnfrage[]> {
  const team = db.select({ id: dealEmployees.employeeId }).from(dealEmployees).where(eq(dealEmployees.dealRecordId, deal));
  const rows = await db
    .select({
      employeeId: crewJobResponses.employeeId,
      name: employees.name,
      answer: crewJobResponses.answer,
      answeredAt: crewJobResponses.answeredAt,
    })
    .from(crewJobResponses)
    .innerJoin(employees, and(eq(employees.id, crewJobResponses.employeeId), eq(employees.workspaceId, ws)))
    .where(and(eq(crewJobResponses.workspaceId, ws), eq(crewJobResponses.dealRecordId, deal), notInArray(crewJobResponses.employeeId, team)))
    .orderBy(asc(crewJobResponses.answeredAt), asc(crewJobResponses.id));
  return rows.map((r) => ({
    employeeId: r.employeeId,
    name: r.name?.trim() || "Ohne Namen",
    answer: r.answer,
    answeredAt: r.answeredAt.toISOString(),
  }));
}
