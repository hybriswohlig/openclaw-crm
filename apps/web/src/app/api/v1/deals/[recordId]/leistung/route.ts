import { NextRequest, NextResponse } from "next/server";
import { badRequest, forbidden, getAuthContext, notFound, success, unauthorized } from "@/lib/api-utils";
import { LeistungFehler, leistungDesDeals, setzeLeistung } from "@/services/deal-leistung";

export const dynamic = "force-dynamic";

/** Wie „Kunde und Adressen“: nur für Menschen in der Sitzung; Bots und API-Schlüssel 403. */
const NUR_SITZUNG = "Die Leistung lässt sich nur in der angemeldeten Sitzung ändern.";

async function dealDa(ws: string, dealId: string): Promise<boolean> {
  const { getObjectBySlug } = await import("@/services/objects");
  const { getRecord } = await import("@/services/records");
  const deals = await getObjectBySlug(ws, "deals");
  return !!deals && !!(await getRecord(deals.id, dealId));
}

/** GET: wirksame Leistung des Deals (`leistung`), ob es ein Angebot gibt, was in der Akte gewählt ist. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ recordId: string }> }) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized(req);
  if (ctx.authMethod !== "cookie") return forbidden(NUR_SITZUNG);
  const { recordId } = await params;
  if (!(await dealDa(ctx.workspaceId, recordId))) return notFound("Deal nicht gefunden");
  return success(await leistungDesDeals(ctx.workspaceId, recordId));
}

/** PUT `{ leistung: "move" | "clearance" | "clearance_move" | "kitchen_installation" }`. */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ recordId: string }> }) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized(req);
  if (ctx.authMethod !== "cookie") return forbidden(NUR_SITZUNG);
  const { recordId } = await params;
  const body = (await req.json().catch(() => null)) as { leistung?: unknown } | null;
  try {
    return success(await setzeLeistung(ctx.workspaceId, recordId, body?.leistung, ctx.userId ?? null));
  } catch (err) {
    if (!(err instanceof LeistungFehler)) throw err;
    if (err.code === "NOT_FOUND") return notFound(err.message);
    if (err.code === "UNGUELTIG") return badRequest(err.message);
    const status = err.code === "KVA_ACCEPTED" ? 409 : 503;
    return NextResponse.json({ error: { code: err.code, message: err.message } }, { status });
  }
}
