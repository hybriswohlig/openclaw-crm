/**
 * Nach einer Zahlung: von Durchgeführt auf Bezahlt, wenn eine Rechnung
 * existiert und der offene Rest 0 ist. Nie rückwärts, nie aus anderen Stufen.
 * Geschrieben wird bedingt (`statusWechselnWennNoch`): hat jemand die Stufe
 * seit dem Lesen geändert, etwa auf Verloren, bleibt sie so.
 */
import { db } from "@/db";
import { dealDocuments } from "@/db/schema/financial";
import { attributes, objects, statuses } from "@/db/schema/objects";
import { recordValues } from "@/db/schema/records";
import { and, asc, desc, eq } from "drizzle-orm";
import { stufenKategorie } from "./lagekarte/status";
import { offenerRest } from "./offener-rest";
import { statusWechselnWennNoch } from "./records";

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
      statusId: statuses.id,
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

  const geschrieben = await statusWechselnWennNoch({
    workspaceId,
    objectId: aktuell.objectId,
    objectSlug: "deals",
    recordId: dealRecordId,
    attributeId: aktuell.attributeId,
    attributeSlug: "stage",
    vonStatusId: aktuell.statusId,
    nachStatusId: bezahlt.id,
    updatedBy: userId,
  });
  return { stufeGesetzt: geschrieben };
}
