import { NextRequest, NextResponse } from "next/server";
import { getAuthContext, unauthorized, success } from "@/lib/api-utils";
import { db } from "@/db";
import { dealInventoryItems } from "@/db/schema/inventory";
import { and, eq, sql } from "drizzle-orm";

/**
 * Manuelles Item ("weiß ich, steht aber nirgends im Chat"). source='operator',
 * damit Re-Extraktionen die Zeile nie ersetzen; Duplikate gegen den Namen
 * werden abgefangen und geben die bestehende Zeile zurück.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ recordId: string }> }
) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();

  const { recordId } = await params;
  const body = (await req.json().catch(() => ({}))) as {
    name?: string;
    quantity?: number;
  };
  const name = body.name?.trim();
  if (!name) {
    return NextResponse.json({ error: "name ist erforderlich" }, { status: 400 });
  }

  const [existing] = await db
    .select()
    .from(dealInventoryItems)
    .where(
      and(
        eq(dealInventoryItems.workspaceId, ctx.workspaceId),
        eq(dealInventoryItems.dealRecordId, recordId),
        sql`lower(${dealInventoryItems.name}) = ${name.toLowerCase()}`
      )
    )
    .limit(1);
  if (existing) return success(existing);

  const [{ maxSort }] = await db
    .select({ maxSort: sql<number>`coalesce(max(${dealInventoryItems.sortOrder}), -1)` })
    .from(dealInventoryItems)
    .where(
      and(
        eq(dealInventoryItems.workspaceId, ctx.workspaceId),
        eq(dealInventoryItems.dealRecordId, recordId)
      )
    );

  const [row] = await db
    .insert(dealInventoryItems)
    .values({
      workspaceId: ctx.workspaceId,
      dealRecordId: recordId,
      name,
      quantity:
        typeof body.quantity === "number" && Number.isInteger(body.quantity) && body.quantity >= 1
          ? body.quantity
          : 1,
      source: "operator",
      confidence: "hoch",
      sortOrder: Number(maxSort) + 1,
    })
    .returning();
  return success(row);
}
