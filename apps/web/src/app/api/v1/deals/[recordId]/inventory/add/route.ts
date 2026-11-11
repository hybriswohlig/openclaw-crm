import { NextRequest, NextResponse } from "next/server";
import { forbidden, getAuthContext, isReadOnlyApiKey, unauthorized, success } from "@/lib/api-utils";
import { emitEvent } from "@/services/activity-events";
import { INVENTAR_KORRIGIERT_EVENT, korrekturPayload } from "@/lib/inventar-korrektur";
import { db } from "@/db";
import { dealInventoryItems } from "@/db/schema/inventory";
import { and, eq, sql } from "drizzle-orm";
import { kalkulationAnstossen } from "@/services/rechner/ausloeser";

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
  if (!ctx) return unauthorized(req);
  if (isReadOnlyApiKey(ctx)) return forbidden("Nur-Lese-Schlüssel darf das Inventar nicht ändern.");

  const { recordId } = await params;
  const gesperrt = await verschicktFuerSchluessel(ctx, recordId);
  if (gesperrt) return gesperrt;
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
  await emitEvent({
    workspaceId: ctx.workspaceId,
    recordId,
    objectSlug: "deals",
    eventType: INVENTAR_KORRIGIERT_EVENT,
    payload: { ...korrekturPayload(row.id, null, row) },
    actorId: ctx.userId ?? null,
  });
  kalkulationAnstossen(ctx.workspaceId, recordId);
  return success(row);
}

/** Plan 16 (Review 1): Schlüssel (Bots) ändern das Inventar nach dem Versand nicht mehr direkt. */
async function verschicktFuerSchluessel(ctx: { authMethod?: string; workspaceId: string }, recordId: string): Promise<NextResponse | null> {
  if (ctx.authMethod !== "api_key") return null;
  const { istVerschickt } = await import("@/services/kalkulation-versionen-speicher");
  if (!(await istVerschickt(ctx.workspaceId, recordId))) return null;
  return NextResponse.json(
    {
      error: {
        code: "AENDERUNG_NUR_MENSCH",
        message: "Das Angebot ist schon verschickt. Inventar-Änderungen bitte über crm_propose_offer_change vorschlagen; ein Mensch übernimmt sie.",
      },
    },
    { status: 409 }
  );
}
