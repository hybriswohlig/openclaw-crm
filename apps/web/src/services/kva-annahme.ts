/**
 * Aktive KV-Annahme je Deal: lesen, sperren, aufheben, Nachweise binden.
 * „Aktiv“ = superseded_at IS NULL. Aufgehobene Zeilen bleiben als Nachweis.
 */
import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { and, desc, eq, isNotNull, isNull } from "drizzle-orm";
import { db } from "@/db";
import { kvaConfirmations } from "@/db/schema/customer-portal";
import { quotations } from "@/db/schema/quotations";
import { dealDocuments } from "@/db/schema/financial";
import { emitEvent } from "./activity-events";
import { ladeAgbHtml } from "./agb";
import type { AcceptanceRecord, WiderrufModus } from "@openclaw-crm/customer-portal-core";

export type KvaConfirmationRow = typeof kvaConfirmations.$inferSelect;

export function aktivBedingung(dealRecordId: string) {
  return and(eq(kvaConfirmations.dealRecordId, dealRecordId), isNull(kvaConfirmations.supersededAt));
}

export async function ladeAktiveAnnahme(dealRecordId: string): Promise<KvaConfirmationRow | null> {
  const [row] = await db.select().from(kvaConfirmations).where(aktivBedingung(dealRecordId)).limit(1);
  return row ?? null;
}

/** Zeitpunkt der letzten aufgehobenen Annahme, null wenn es keine gibt. */
export async function ladeLetzteAufhebung(dealRecordId: string): Promise<Date | null> {
  const [row] = await db
    .select({ supersededAt: kvaConfirmations.supersededAt })
    .from(kvaConfirmations)
    .where(and(eq(kvaConfirmations.dealRecordId, dealRecordId), isNotNull(kvaConfirmations.supersededAt)))
    .orderBy(desc(kvaConfirmations.supersededAt))
    .limit(1);
  return row?.supersededAt ?? null;
}

export class AngebotAngenommenError extends Error {
  readonly code = "KVA_ACCEPTED";
  constructor() {
    super("Das Angebot wurde vom Kunden bereits angenommen. Änderungen erst nach „Annahme aufheben“ im Status-Link.");
  }
}

export async function pruefeNichtAngenommen(dealRecordId: string): Promise<void> {
  if (await ladeAktiveAnnahme(dealRecordId)) throw new AngebotAngenommenError();
}

/** Für Operator-Routen: 409 mit deutscher Meldung, sonst null (weiterwerfen). */
export function annahmeSperrAntwort(err: unknown): NextResponse | null {
  if (!(err instanceof AngebotAngenommenError)) return null;
  return NextResponse.json({ error: { code: err.code, message: err.message } }, { status: 409 });
}

export async function annahmeAufheben(input: {
  workspaceId: string;
  dealRecordId: string;
  userId: string;
  grund: string;
}): Promise<"aufgehoben" | "keine_annahme"> {
  const aufgehoben = await db
    .update(kvaConfirmations)
    .set({ supersededAt: new Date(), supersededBy: input.userId, supersededReason: input.grund.slice(0, 500) })
    .where(and(aktivBedingung(input.dealRecordId), eq(kvaConfirmations.workspaceId, input.workspaceId)))
    .returning({ id: kvaConfirmations.id, total: kvaConfirmations.confirmedTotalCents });
  if (aufgehoben.length === 0) return "keine_annahme";
  await emitEvent({
    workspaceId: input.workspaceId,
    recordId: input.dealRecordId,
    objectSlug: "deals",
    eventType: "kva.annahme_aufgehoben",
    payload: { confirmationId: aufgehoben[0].id, confirmedTotalCents: aufgehoben[0].total, grund: input.grund, userId: input.userId },
  });
  return "aufgehoben";
}

type ZeileFuerRecord = Pick<
  KvaConfirmationRow,
  | "signedAt" | "acceptedFullName" | "agbVersionAccepted" | "confirmedTotalCents"
  | "widerrufVerzichtAccepted" | "selectedOptionName" | "widerrufModus"
  | "vorzeitigerBeginnVerlangt" | "quotationDocumentId"
>;

export function annahmeAusZeile(row: ZeileFuerRecord): AcceptanceRecord {
  return {
    signedAt: row.signedAt.toISOString(),
    acceptedFullName: row.acceptedFullName,
    agbVersionAccepted: row.agbVersionAccepted,
    confirmedTotalCents: row.confirmedTotalCents,
    selectedOptionName: row.selectedOptionName,
    widerrufModus: (row.widerrufModus as WiderrufModus | null) ?? null,
    vorzeitigerBeginnVerlangt: row.vorzeitigerBeginnVerlangt,
    widerrufVerzichtAccepted: row.widerrufVerzichtAccepted,
    quotationDocumentId: row.quotationDocumentId,
  };
}

export function sha256Hex(data: string | Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

/** AGB, wie sie der Kunde in diesem Moment abrufen kann. null = nicht abrufbar. */
export async function ladeAgbFuerAnnahme(firmaSlug: string): Promise<{ text: string; sha256: string } | null> {
  const text = await ladeAgbHtml(firmaSlug);
  return text ? { text, sha256: sha256Hex(text) } : null;
}

/**
 * Das KV-PDF, das der Kunde gerade sieht: neuestes quotation-Dokument, das
 * nicht älter ist als das Angebot (gleiche Regel wie das Portal).
 */
export async function aktuellesKvDokument(
  workspaceId: string,
  dealRecordId: string
): Promise<{ id: string; sha256: string } | null> {
  const [q] = await db
    .select({ updatedAt: quotations.updatedAt })
    .from(quotations)
    .where(eq(quotations.dealRecordId, dealRecordId))
    .limit(1);
  const docs = await db
    .select({ id: dealDocuments.id, uploadedAt: dealDocuments.uploadedAt, fileContent: dealDocuments.fileContent })
    .from(dealDocuments)
    .where(and(eq(dealDocuments.workspaceId, workspaceId), eq(dealDocuments.dealRecordId, dealRecordId), eq(dealDocuments.documentType, "quotation")))
    .orderBy(desc(dealDocuments.uploadedAt))
    .limit(1);
  const doc = docs[0];
  if (!doc || (q && doc.uploadedAt < q.updatedAt)) return null;
  return { id: doc.id, sha256: sha256Hex(Buffer.from(doc.fileContent, "base64")) };
}
