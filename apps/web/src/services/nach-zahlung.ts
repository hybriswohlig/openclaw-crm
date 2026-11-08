/**
 * Gemeinsamer Abschluss (Plan 9, Entscheidung 11) nach Zahlung, Storno,
 * Rechnung und „Durchgeführt“: `abschlussAus` entscheidet über
 * `deal_workflow_state.bezahlt_am` (setzen bei Rest 0 mit gestellter Rechnung,
 * leeren bei Rest > 0) und über Durchgeführt → Bezahlt. Die Stufe geht nie
 * zurück, nie aus anderen Stufen. Geschrieben wird bedingt
 * (`statusWechselnWennNoch`): hat jemand die Stufe seit dem Lesen geändert,
 * etwa auf Verloren, bleibt sie so. Altbestand ohne Rechnungsdatensatz: ein
 * Rechnungs-PDF zählt als gestellt.
 */
import { db } from "@/db";
import { dealDocuments } from "@/db/schema/financial";
import { attributes, objects, statuses } from "@/db/schema/objects";
import { recordValues } from "@/db/schema/records";
import { and, asc, desc, eq, isNotNull, isNull } from "drizzle-orm";
import { dealWorkflowState } from "@/db/schema/deal-workflow-state";
import { dealInvoices } from "@/db/schema/deal-invoices";
import { abschlussAus } from "@/lib/geld";
import { stufenKategorie } from "./lagekarte/status";
import { offenerRest } from "./offener-rest";
import { statusWechselnWennNoch } from "./records";

export async function nachZahlung(
  workspaceId: string,
  dealRecordId: string,
  userId: string | null,
): Promise<{ stufeGesetzt: boolean; bezahltAm?: "gesetzt" | "geleert" | null }> {
  const rest = await offenerRest(workspaceId, dealRecordId);
  const rechnungGestellt = await hatGestellteRechnung(workspaceId, dealRecordId);
  const [zustand] = await db
    .select({ bezahltAm: dealWorkflowState.bezahltAm })
    .from(dealWorkflowState)
    .where(eq(dealWorkflowState.recordId, dealRecordId))
    .limit(1);
  const aktuell = await aktuelleStufe(workspaceId, dealRecordId);
  const kategorie = aktuell ? stufenKategorie({ titel: aktuell.titel, kategorie: aktuell.kategorie }) : null;
  const e = abschlussAus({
    restCent: rest.restCent,
    rechnungGestellt,
    bezahltAm: zustand?.bezahltAm ? zustand.bezahltAm.toISOString() : null,
    kategorie,
  });

  let bezahltAm: "gesetzt" | "geleert" | null = null;
  if (e.bezahltAmSetzen) {
    const jetzt = new Date();
    const rows = await db
      .insert(dealWorkflowState)
      .values({ recordId: dealRecordId, bezahltAm: jetzt, updatedAt: jetzt })
      .onConflictDoUpdate({
        target: dealWorkflowState.recordId,
        set: { bezahltAm: jetzt, updatedAt: jetzt },
        setWhere: isNull(dealWorkflowState.bezahltAm),
      })
      .returning({ id: dealWorkflowState.recordId });
    if (rows.length > 0) bezahltAm = "gesetzt";
  } else if (e.bezahltAmLeeren) {
    const rows = await db
      .update(dealWorkflowState)
      .set({ bezahltAm: null, updatedAt: new Date() })
      .where(and(eq(dealWorkflowState.recordId, dealRecordId), isNotNull(dealWorkflowState.bezahltAm)))
      .returning({ id: dealWorkflowState.recordId });
    if (rows.length > 0) bezahltAm = "geleert";
  }

  if (!e.stufeBezahlt || !aktuell) return { stufeGesetzt: false, bezahltAm };

  const [bezahlt] = await db
    .select({ id: statuses.id })
    .from(statuses)
    .where(and(eq(statuses.attributeId, aktuell.attributeId), eq(statuses.stageCategory, "paid")))
    .orderBy(desc(statuses.isActive), asc(statuses.sortOrder))
    .limit(1);
  if (!bezahlt) return { stufeGesetzt: false, bezahltAm };

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
  return { stufeGesetzt: geschrieben, bezahltAm };
}

/** Gestellte Rechnung (Datensatz) oder, ohne jeden Datensatz, ein Rechnungs-PDF (Altbestand). */
async function hatGestellteRechnung(workspaceId: string, dealRecordId: string): Promise<boolean> {
  const datensaetze = await db
    .select({ status: dealInvoices.status })
    .from(dealInvoices)
    .where(and(eq(dealInvoices.workspaceId, workspaceId), eq(dealInvoices.dealRecordId, dealRecordId)));
  if (datensaetze.length > 0) return datensaetze.some((d) => d.status === "gestellt");
  const [pdf] = await db
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
  return !!pdf;
}

async function aktuelleStufe(workspaceId: string, dealRecordId: string) {
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
  return aktuell ?? null;
}
