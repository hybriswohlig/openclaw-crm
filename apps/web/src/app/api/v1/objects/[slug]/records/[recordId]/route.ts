import { NextRequest, NextResponse } from "next/server";
import { getAuthContext, unauthorized, notFound, badRequest, success } from "@/lib/api-utils";
import { getObjectBySlug } from "@/services/objects";
import { getRecord, updateRecord, deleteRecord } from "@/services/records";
import { db } from "@/db";
import { payments, expenses, employeeLedger } from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import { dealReferenz, kalkulationAnstossen } from "@/services/rechner/ausloeser";
import { lossReasonUpdateProblem, resolveDealSelectInputs } from "@/services/deal-attribution";
import { CRM_UI_CLIENT_HEADER, CRM_UI_CLIENT_VALUE } from "@/lib/deal-source";
import { DEFAULT_KONTAKTART, KONTAKTART_SLUG } from "@/lib/kontaktart";
import { applyKontaktart, kontaktartFromPeopleInput, resolvePeopleKontaktartInput } from "@/services/kontaktart";

/**
 * Deals with financial bookings must not be deleted: payments/expenses would
 * cascade away while ledger earnings stay, silently rewriting settled months
 * (Finanz-Audit Phase 0 Punkt 5).
 */
async function dealHasFinancialBookings(recordId: string): Promise<boolean> {
  const [[pay], [exp], [led]] = await Promise.all([
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(payments)
      .where(eq(payments.dealRecordId, recordId)),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(expenses)
      .where(eq(expenses.dealRecordId, recordId)),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(employeeLedger)
      .where(eq(employeeLedger.dealRecordId, recordId)),
  ]);
  return pay.n > 0 || exp.n > 0 || led.n > 0;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string; recordId: string }> }
) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();

  const { slug, recordId } = await params;
  const obj = await getObjectBySlug(ctx.workspaceId, slug);
  if (!obj) return notFound("Object not found");

  const record = await getRecord(obj.id, recordId);
  if (!record) return notFound("Record not found");

  return success(record);
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string; recordId: string }> }
) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();

  const { slug, recordId } = await params;
  const obj = await getObjectBySlug(ctx.workspaceId, slug);
  if (!obj) return notFound("Object not found");

  const body = await req.json();
  let { values } = body;

  if (!values || typeof values !== "object") {
    return badRequest("values object is required");
  }

  if (slug === "deals") {
    values = await resolveDealSelectInputs(obj.id, values);
    const problem = await lossReasonUpdateProblem({
      objectId: obj.id,
      recordId,
      values,
      enforce: req.headers.get(CRM_UI_CLIENT_HEADER) === CRM_UI_CLIENT_VALUE,
    });
    if (problem) {
      return NextResponse.json({ error: { code: "LOSS_REASON_REQUIRED", message: problem } }, { status: 400 });
    }
  }

  const kontaktartRaw = slug === "people" ? values[KONTAKTART_SLUG] : undefined;
  if (slug === "people" && typeof kontaktartRaw === "string") {
    values = await resolvePeopleKontaktartInput(obj.id, values);
  }

  const record = await updateRecord(obj.id, recordId, values, ctx.userId);
  if (!record) return notFound("Record not found");

  if (slug === "people" && Object.prototype.hasOwnProperty.call(body.values ?? {}, KONTAKTART_SLUG)) {
    const slugValue = await kontaktartFromPeopleInput(obj.id, kontaktartRaw);
    const cleared = kontaktartRaw == null || kontaktartRaw === "";
    if (slugValue || cleared) {
      await applyKontaktart({
        workspaceId: ctx.workspaceId,
        kontaktart: slugValue ?? DEFAULT_KONTAKTART,
        personRecordId: recordId,
        actorId: ctx.userId,
        personAlreadyWritten: true,
      });
    }
  }

  // Lead bearbeitet (Adresse, Etage, Wohnfläche …) → Kalkulation aktualisieren.
  if (slug === "deals") kalkulationAnstossen(ctx.workspaceId, recordId);
  // Auftrag bearbeitet (Laufweg, Halteverbot, Einpackservice, Kartons) → Kalkulation des verknüpften Leads.
  if (slug === "auftraege") {
    const deal = dealReferenz(record.values as Record<string, unknown>);
    if (deal) kalkulationAnstossen(ctx.workspaceId, deal);
  }
  return success(record);
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string; recordId: string }> }
) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();

  const { slug, recordId } = await params;
  const obj = await getObjectBySlug(ctx.workspaceId, slug);
  if (!obj) return notFound("Object not found");

  if (slug === "deals" && (await dealHasFinancialBookings(recordId))) {
    return NextResponse.json(
      {
        error: {
          code: "CONFLICT",
          message:
            "Dieser Auftrag hat Finanzbuchungen und kann nicht gelöscht werden. Buchungen zuerst löschen oder umbuchen.",
        },
      },
      { status: 409 }
    );
  }

  const deleted = await deleteRecord(obj.id, recordId);
  if (!deleted) return notFound("Record not found");

  return success({ id: deleted.id, deleted: true });
}
