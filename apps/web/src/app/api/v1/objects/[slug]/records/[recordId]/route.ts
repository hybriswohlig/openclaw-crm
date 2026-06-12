import { NextRequest, NextResponse } from "next/server";
import { getAuthContext, unauthorized, notFound, badRequest, success } from "@/lib/api-utils";
import { getObjectBySlug } from "@/services/objects";
import { getRecord, updateRecord, deleteRecord } from "@/services/records";
import { db } from "@/db";
import { payments, expenses, employeeLedger } from "@/db/schema";
import { eq, sql } from "drizzle-orm";

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
  const { values } = body;

  if (!values || typeof values !== "object") {
    return badRequest("values object is required");
  }

  const record = await updateRecord(obj.id, recordId, values, ctx.userId);
  if (!record) return notFound("Record not found");

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
