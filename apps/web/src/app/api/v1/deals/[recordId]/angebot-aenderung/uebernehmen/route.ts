import { NextRequest } from "next/server";
import { schreibRoute, type Params } from "@/lib/angebot-aenderung-antwort";
import { uebernehmen } from "@/services/angebot-aenderung";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST { ids, leadBestaetigt? } → abgehakte Vorschläge übernehmen (nur Menschen). Ändern sie das
 * Inventar und fehlt `leadBestaetigt`, 409 LEAD_RUECKFRAGE mit `details.lead` (nichts geschrieben).
 */
export async function POST(req: NextRequest, p: Params) {
  return schreibRoute(req, p, (ctx, deal, autor, body) =>
    uebernehmen(ctx.workspaceId, deal, body.ids, { leadBestaetigt: body.leadBestaetigt === true }, autor)
  );
}
