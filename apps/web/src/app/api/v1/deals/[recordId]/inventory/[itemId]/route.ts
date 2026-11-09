import { NextRequest, NextResponse } from "next/server";
import { forbidden, getAuthContext, isReadOnlyApiKey, unauthorized, notFound, success } from "@/lib/api-utils";
import { db } from "@/db";
import { dealInventoryItems } from "@/db/schema/inventory";
import { and, eq } from "drizzle-orm";
import { kalkulationAnstossen } from "@/services/rechner/ausloeser";
import { parseInventoryOwnerPatch } from "@/services/inventory-owner";
import { emitEvent } from "@/services/activity-events";
import { INVENTAR_KORRIGIERT_EVENT, korrekturPayload, pruefeGroesseVolumen } from "@/lib/inventar-korrektur";

const zeileWo = (itemId: string, recordId: string, ws: string) =>
  and(eq(dealInventoryItems.id, itemId), eq(dealInventoryItems.dealRecordId, recordId), eq(dealInventoryItems.workspaceId, ws));

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
  if (!ctx) return unauthorized(req);
  if (isReadOnlyApiKey(ctx)) return forbidden("Nur-Lese-Schlüssel darf das Inventar nicht ändern.");

  const { recordId, itemId } = await params;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  // Plan 15 (Bauteil 14): Stand vorher für die Korrektur (Herkunft und Lernsignal).
  const [vorher] = await db.select().from(dealInventoryItems).where(zeileWo(itemId, recordId, ctx.workspaceId)).limit(1);
  if (!vorher) return notFound("Inventar-Zeile nicht gefunden");
  const owners = parseInventoryOwnerPatch(body);
  if (!owners.ok) {
    return NextResponse.json({ error: owners.error }, { status: 400 });
  }

  const updates: Record<string, unknown> = { updatedAt: new Date(), source: "operator" };
  if (typeof body.moveFlag === "boolean") updates.moveFlag = body.moveFlag;
  if (typeof body.needsPhoto === "boolean") updates.needsPhoto = body.needsPhoto;
  if (typeof body.quantity === "number" && Number.isInteger(body.quantity) && body.quantity >= 1) {
    updates.quantity = body.quantity;
  }
  if (typeof body.name === "string" && body.name.trim()) updates.name = body.name.trim();
  // Plan 15: Größe und m³ je Stück (Zeile = je Stück × Menge), wenn es keinen Katalogtreffer gibt.
  const gv = pruefeGroesseVolumen(body, typeof updates.quantity === "number" ? updates.quantity : vorher.quantity);
  if (!gv.ok) return NextResponse.json({ error: gv.fehler }, { status: 400 });
  Object.assign(updates, gv.patch);
  if (owners.patch.dismantlingOwner) {
    updates.dismantlingOwner = owners.patch.dismantlingOwner;
  }
  if (owners.patch.assemblyOwner) {
    updates.assemblyOwner = owners.patch.assemblyOwner;
  }
  // company means we take the piece apart or put it back together.
  if (owners.patch.dismantlingOwner === "company" || owners.patch.assemblyOwner === "company") {
    updates.disassemblyRequired = true;
  }
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
  await emitEvent({
    workspaceId: ctx.workspaceId,
    recordId,
    objectSlug: "deals",
    eventType: INVENTAR_KORRIGIERT_EVENT,
    payload: { ...korrekturPayload(itemId, vorher, row) },
    actorId: ctx.userId ?? null,
  });
  kalkulationAnstossen(ctx.workspaceId, recordId);
  return success(row);
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ recordId: string; itemId: string }> }
) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized(req);
  if (isReadOnlyApiKey(ctx)) return forbidden("Nur-Lese-Schlüssel darf das Inventar nicht ändern.");

  const { recordId, itemId } = await params;
  const [vorher] = await db.select().from(dealInventoryItems).where(zeileWo(itemId, recordId, ctx.workspaceId)).limit(1);
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
  if (vorher) {
    await emitEvent({
      workspaceId: ctx.workspaceId,
      recordId,
      objectSlug: "deals",
      eventType: INVENTAR_KORRIGIERT_EVENT,
      payload: { ...korrekturPayload(itemId, vorher, null) },
      actorId: ctx.userId ?? null,
    });
  }
  kalkulationAnstossen(ctx.workspaceId, recordId);
  return success({ deleted: row.id });
}
