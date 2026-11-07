import { NextRequest, NextResponse } from "next/server";
import { badRequest, forbidden, getAuthContext, isReadOnlyApiKey, notFound, success, unauthorized } from "@/lib/api-utils";
import { dealImWorkspace, dealNichtGefunden } from "@/lib/kalkulation-versionen-antwort";
import { GeldFehler, grundGueltig, GELD_FEHLER_TEXT } from "@/lib/geld";
import { rechnungStornieren } from "@/services/rechnungen";

export const dynamic = "force-dynamic";

/**
 * POST { grund } → Rechnung stornieren (Plan 9, G4). Nur ein Mensch:
 * Nur-Lese-Schlüssel und Agent 403. Fremder Deal 404, zweites Storno 409.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ recordId: string; invoiceId: string }> }
) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized(req);
  if (isReadOnlyApiKey(ctx)) return forbidden("Nur-Lese-Schlüssel darf nicht stornieren.");
  if (ctx.authMethod === "api_key") return forbidden("Stornieren darf nur ein Mensch.");
  const { recordId, invoiceId } = await params;
  if (!(await dealImWorkspace(ctx.workspaceId, recordId))) return dealNichtGefunden();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest("Invalid JSON body");
  }
  const grund = grundGueltig((body as { grund?: unknown } | null)?.grund as string | undefined);
  if (!grund) return badRequest(GELD_FEHLER_TEXT.GRUND_FEHLT);

  try {
    const zeile = await rechnungStornieren(ctx.workspaceId, recordId, invoiceId, grund, ctx.userId);
    return success({ id: zeile.id, status: zeile.status, nummer: zeile.nummer });
  } catch (err) {
    if (err instanceof GeldFehler) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
    }
    if ((err as { status?: number }).status === 404) return notFound("Rechnung nicht gefunden.");
    throw err;
  }
}
