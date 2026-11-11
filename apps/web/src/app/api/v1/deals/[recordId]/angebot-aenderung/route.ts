import { NextRequest } from "next/server";
import { getAuthContext, success, unauthorized } from "@/lib/api-utils";
import { aenderungsFehlerAntwort, schreibRoute, type Params } from "@/lib/angebot-aenderung-antwort";
import { autorAus, dealImWorkspace, dealNichtGefunden } from "@/lib/kalkulation-versionen-antwort";
import { ansicht, starten } from "@/services/angebot-aenderung";

export const dynamic = "force-dynamic";

/**
 * GET → Stand von „Angebot ändern“: maßgebliche Version (verschickt, angenommen), Vorgang
 * (Entwurf oder gesperrt), Vorschläge, Verlauf, Fotos, Vergleich alt ↔ neu, Nachrichtenentwurf.
 * Nur lesen, kein Rechner- und kein KI-Aufruf.
 */
export async function GET(req: NextRequest, { params }: Params) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized(req);
  const { recordId } = await params;
  if (!(await dealImWorkspace(ctx.workspaceId, recordId))) return dealNichtGefunden();
  try {
    const a = await ansicht(ctx.workspaceId, recordId);
    return success({ ...a, darfAnnahmeAufheben: ctx.workspaceRole === "admin" && autorAus(ctx).quelle === "mensch" });
  } catch (err) {
    const antwort = aenderungsFehlerAntwort(err);
    if (antwort) return antwort;
    throw err;
  }
}

/** POST (leer) → Änderung starten: nächster Entwurf aus der maßgeblichen Version. `{ ergebnis: { entwurfVersion, neu }, ansicht }`. */
export async function POST(req: NextRequest, p: Params) {
  return schreibRoute(req, p, (ctx, deal, autor) => starten(ctx.workspaceId, deal, autor));
}
