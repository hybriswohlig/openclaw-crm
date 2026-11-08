import { NextRequest, NextResponse } from "next/server";
import { badRequest, forbidden, getAuthContext, isReadOnlyApiKey, success, unauthorized } from "@/lib/api-utils";
import { dealImWorkspace, dealNichtGefunden } from "@/lib/kalkulation-versionen-antwort";
import { GeldFehler } from "@/lib/geld";
import { rechnungBetragNachtragen } from "@/services/rechnungen";

export const dynamic = "force-dynamic";

/**
 * PUT { bruttoCent } → Betrag einer Altrechnung ohne Betrag nachtragen
 * (Fix-Welle I3). Nur ein Mensch in einer Sitzung; fremder Deal 404,
 * keine nachtragbare Altrechnung 409.
 */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ recordId: string; invoiceId: string }> }) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized(req);
  if (isReadOnlyApiKey(ctx) || ctx.authMethod === "api_key") return forbidden("Den Rechnungsbetrag trägt nur ein Mensch nach.");
  const { recordId, invoiceId } = await params;
  if (!(await dealImWorkspace(ctx.workspaceId, recordId))) return dealNichtGefunden();
  const body = (await req.json().catch(() => null)) as { bruttoCent?: unknown } | null;
  const cent = body?.bruttoCent;
  if (typeof cent !== "number" || !Number.isInteger(cent) || cent <= 0) return badRequest("bruttoCent muss eine ganze Zahl größer 0 sein.");
  try {
    const zeile = await rechnungBetragNachtragen(ctx.workspaceId, recordId, invoiceId, cent, ctx.userId);
    if (!zeile) {
      return NextResponse.json(
        { error: { code: "NICHT_NACHTRAGBAR", message: "Nur bei einer alten Rechnung ohne Betrag möglich." } },
        { status: 409 }
      );
    }
    return success({ id: zeile.id, bruttoCent: zeile.bruttoCent });
  } catch (err) {
    if (err instanceof GeldFehler) return NextResponse.json({ error: { code: err.code, message: err.message } }, { status: err.status });
    throw err;
  }
}
