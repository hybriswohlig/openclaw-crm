import { NextRequest } from "next/server";
import { getAuthContext, success, unauthorized } from "@/lib/api-utils";
import { dealImWorkspace, dealNichtGefunden } from "@/lib/kalkulation-versionen-antwort";
import { rechnungsVorschlag } from "@/services/rechnungen";

export const dynamic = "force-dynamic";

/**
 * GET → `RechnungsVorschlag` für den Rechnungsschritt (Plan 9, Entscheidung 17):
 * Betrag, Stunden-Vorschlag, Fälligkeit, aktive Rechnung, Sperrgrund. Nur lesen;
 * Agent und Nur-Lese-Schlüssel dürfen lesen. Fremder Deal 404.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ recordId: string }> }) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized(req);
  const { recordId } = await params;
  if (!(await dealImWorkspace(ctx.workspaceId, recordId))) return dealNichtGefunden();
  return success(await rechnungsVorschlag(ctx.workspaceId, recordId));
}
