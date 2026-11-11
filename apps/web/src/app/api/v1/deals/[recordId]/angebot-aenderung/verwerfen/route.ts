import { NextRequest } from "next/server";
import { schreibRoute, type Params } from "@/lib/angebot-aenderung-antwort";
import { verwerfen } from "@/services/angebot-aenderung";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** POST { ids, leadBestaetigt? } → Vorschläge verwerfen (nur Menschen); Foto-Teile verlassen dabei das Inventar (Rückfrage). */
export async function POST(req: NextRequest, p: Params) {
  return schreibRoute(req, p, (ctx, deal, autor, body) =>
    verwerfen(ctx.workspaceId, deal, body.ids, { leadBestaetigt: body.leadBestaetigt === true }, autor)
  );
}
