/**
 * Aktive KV-Annahme je Deal: lesen, sperren, aufheben, Nachweise binden.
 * „Aktiv“ = superseded_at IS NULL. Aufgehobene Zeilen bleiben als Nachweis.
 */
import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { and, desc, eq, isNotNull, isNull } from "drizzle-orm";
import { db } from "@/db";
import { kvaConfirmations } from "@/db/schema/customer-portal";
import { dealDocuments } from "@/db/schema/financial";
import { emitEvent } from "./activity-events";
import { ladeAgbHtml } from "./agb";
import type { AcceptanceRecord, UnterschriftArt, WiderrufModus } from "@openclaw-crm/customer-portal-core";

export type KvaConfirmationRow = typeof kvaConfirmations.$inferSelect;

/** db oder eine laufende Transaktion (z. B. unter `angebotSperren`). */
export type DbExecutor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Aktive Annahme des Deals; mit `workspaceId` nur in diesem Workspace. */
export function aktivBedingung(dealRecordId: string, workspaceId?: string) {
  return and(
    eq(kvaConfirmations.dealRecordId, dealRecordId),
    isNull(kvaConfirmations.supersededAt),
    workspaceId ? eq(kvaConfirmations.workspaceId, workspaceId) : undefined
  );
}

export async function ladeAktiveAnnahme(dealRecordId: string, ex: DbExecutor = db): Promise<KvaConfirmationRow | null> {
  const [row] = await ex.select().from(kvaConfirmations).where(aktivBedingung(dealRecordId)).limit(1);
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

/** Mit `ex` = Transaktion unter `angebotSperren`: die Prüfung gilt bis zum Commit. */
export async function pruefeNichtAngenommen(dealRecordId: string, ex: DbExecutor = db): Promise<void> {
  if (await ladeAktiveAnnahme(dealRecordId, ex)) throw new AngebotAngenommenError();
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
    .where(aktivBedingung(input.dealRecordId, input.workspaceId))
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
  | "unterschriftAt" | "unterschriftName" | "unterschriftArt" | "vertragDocumentId"
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
    // Eine Reservierung ohne abgelegten Vertrag ist noch keine Unterschrift.
    unterschrift:
      row.unterschriftAt && row.vertragDocumentId && row.unterschriftName
        ? {
            at: row.unterschriftAt.toISOString(),
            name: row.unterschriftName,
            art: (row.unterschriftArt === "gezeichnet" ? "gezeichnet" : "getippt") as UnterschriftArt,
          }
        : null,
  };
}

export interface Umzugsrahmen {
  moveDate: string | null;
  fromAddress: string | null;
  toAddress: string | null;
}

export interface AbweichungVonAnnahme {
  feld: "Termin" | "Auszug" | "Einzug";
  angenommen: string;
  aktuell: string | null;
}

/**
 * Was am Deal seit der Annahme anders ist als im angenommenen Stand. Das
 * Portal zeigt den aktuellen Stand; das Team soll sehen, wenn er vom Vertrag
 * abweicht. Altannahmen ohne gebundene Werte melden nichts.
 */
export function abweichungenVonAnnahme(gebunden: Umzugsrahmen, aktuell: Umzugsrahmen): AbweichungVonAnnahme[] {
  const gleich = (a: string, b: string | null) =>
    b !== null && a.replace(/\s+/g, " ").trim().toLowerCase() === b.replace(/\s+/g, " ").trim().toLowerCase();
  const felder = [
    ["Termin", gebunden.moveDate, aktuell.moveDate],
    ["Auszug", gebunden.fromAddress, aktuell.fromAddress],
    ["Einzug", gebunden.toAddress, aktuell.toAddress],
  ] as const;
  return felder
    .filter(([, a, b]) => a !== null && !gleich(a, b))
    .map(([feld, a, b]) => ({ feld, angenommen: a!, aktuell: b }));
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
 * Das KV-PDF, das der Kunde gerade sieht: neuestes quotation-Dokument
 * (gleiche Regel wie das Portal). Ein späteres Speichern der Angebotszeile
 * zählt nicht. null nur, wenn kein KV-Dokument existiert. Die Version des
 * PDFs entscheidet über `kvStand` (Annahme gesperrt, wenn sie nicht passt).
 */
export async function aktuellesKvDokument(
  workspaceId: string,
  dealRecordId: string,
  ex: DbExecutor = db
): Promise<{ id: string; sha256: string; calculationVersionId: string | null } | null> {
  const docs = await ex
    .select({ id: dealDocuments.id, fileContent: dealDocuments.fileContent, calculationVersionId: dealDocuments.calculationVersionId })
    .from(dealDocuments)
    .where(and(eq(dealDocuments.workspaceId, workspaceId), eq(dealDocuments.dealRecordId, dealRecordId), eq(dealDocuments.documentType, "quotation")))
    .orderBy(desc(dealDocuments.uploadedAt))
    .limit(1);
  const doc = docs[0];
  if (!doc) return null;
  return {
    id: doc.id,
    sha256: sha256Hex(Buffer.from(doc.fileContent, "base64")),
    calculationVersionId: doc.calculationVersionId ?? null,
  };
}
