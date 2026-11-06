/**
 * Nach einer Zahlung: von Durchgeführt auf Bezahlt, wenn eine Rechnung
 * existiert und der offene Rest 0 ist. Nie rückwärts, nie aus anderen Stufen.
 */
import { db } from "@/db";
import { dealDocuments } from "@/db/schema/financial";
import { attributes, objects, statuses } from "@/db/schema/objects";
import { recordValues } from "@/db/schema/records";
import { and, asc, desc, eq } from "drizzle-orm";
import { stufenKategorie } from "./lagekarte/status";
import { offenerRest } from "./offener-rest";
import { updateRecord } from "./records";

export async function nachZahlung(
  workspaceId: string,
  dealRecordId: string,
  userId: string | null,
): Promise<{ stufeGesetzt: boolean }> {
  const rest = await offenerRest(workspaceId, dealRecordId);
  if (rest.restCent !== 0) return { stufeGesetzt: false };

  const [rechnung] = await db
    .select({ id: dealDocuments.id })
    .from(dealDocuments)
    .where(
      and(
        eq(dealDocuments.workspaceId, workspaceId),
        eq(dealDocuments.dealRecordId, dealRecordId),
        eq(dealDocuments.documentType, "invoice"),
      ),
    )
    .limit(1);
  if (!rechnung) return { stufeGesetzt: false };

  const [aktuell] = await db
    .select({
      objectId: objects.id,
      attributeId: attributes.id,
      kategorie: statuses.stageCategory,
      titel: statuses.title,
    })
    .from(objects)
    .innerJoin(attributes, and(eq(attributes.objectId, objects.id), eq(attributes.slug, "stage")))
    .innerJoin(
      recordValues,
      and(eq(recordValues.attributeId, attributes.id), eq(recordValues.recordId, dealRecordId)),
    )
    .innerJoin(statuses, eq(statuses.id, recordValues.textValue))
    .where(and(eq(objects.workspaceId, workspaceId), eq(objects.slug, "deals")))
    .limit(1);
  if (!aktuell || stufenKategorie({ titel: aktuell.titel, kategorie: aktuell.kategorie }) !== "done_unpaid") {
    return { stufeGesetzt: false };
  }

  const [bezahlt] = await db
    .select({ id: statuses.id })
    .from(statuses)
    .where(and(eq(statuses.attributeId, aktuell.attributeId), eq(statuses.stageCategory, "paid")))
    .orderBy(desc(statuses.isActive), asc(statuses.sortOrder))
    .limit(1);
  if (!bezahlt) return { stufeGesetzt: false };

  const geschrieben = await updateRecord(aktuell.objectId, dealRecordId, { stage: bezahlt.id }, userId);
  return { stufeGesetzt: geschrieben != null };
}
