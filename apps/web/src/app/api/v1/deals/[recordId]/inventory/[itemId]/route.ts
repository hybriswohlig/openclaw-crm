import { NextRequest, NextResponse } from "next/server";
import { getAuthContext, unauthorized, notFound, success } from "@/lib/api-utils";
import { db } from "@/db";
import { dealInventoryItems } from "@/db/schema/inventory";
import { and, eq } from "drizzle-orm";

/**
 * Operator-Korrekturen an einzelnen Inventar-Zeilen. Jede Änderung stempelt
 * source='operator', damit die nächste Chat-Re-Extraktion die Zeile nicht
 * ersetzt (siehe applyDealInventory).
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ recordId: string; itemId: string }> }
) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();

  const { recordId, itemId } = await params;
  const body = (await req.json().catch(() => ({}))) as {
    moveFlag?: boolean;
    quantity?: number;
    name?: string;
    needsPhoto?: boolean;
  };

  const updates: Record<string, unknown> = { updatedAt: new Date(), source: "operator" };
  if (typeof body.moveFlag === "boolean") updates.moveFlag = body.moveFlag;
  if (typeof body.needsPhoto === "boolean") updates.needsPhoto = body.needsPhoto;
  if (typeof body.quantity === "number" && Number.isInteger(body.quantity) && body.quantity >= 1) {
    updates.quantity = body.quantity;
  }
  if (typeof body.name === "string" && body.name.trim()) updates.name = body.name.trim();
  if (Object.keys(updates).length === 2) {
    return NextResponse.json({ error: "keine änderbaren Felder im Body" }, { status: 400 });
  }

  const [row] = await db
    .update(dealInventoryItems)
    .set(updates)
    .where(
      and(
        eq(dealInventoryItems.id, itemId),
        eq(dealInventoryItems.dealRecordId, recordId),
        eq(dealInventoryItems.workspaceId, ctx.workspaceId)
      )
    )
    .returning();
  if (!row) return notFound("Inventar-Zeile nicht gefunden");
  return success(row);
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ recordId: string; itemId: string }> }
) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();

  const { recordId, itemId } = await params;
  const [row] = await db
    .delete(dealInventoryItems)
    .where(
      and(
        eq(dealInventoryItems.id, itemId),
        eq(dealInventoryItems.dealRecordId, recordId),
        eq(dealInventoryItems.workspaceId, ctx.workspaceId)
      )
    )
    .returning({ id: dealInventoryItems.id });
  if (!row) return notFound("Inventar-Zeile nicht gefunden");
  return success({ deleted: row.id });
}
