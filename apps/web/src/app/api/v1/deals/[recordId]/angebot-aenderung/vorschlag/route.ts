import { NextRequest } from "next/server";
import { schreibRoute, type Params } from "@/lib/angebot-aenderung-antwort";
import { vorschlagen } from "@/services/angebot-aenderung";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST { aenderungen: [...], zitat? } → strukturierte Änderungen als Vorschläge (Bots und Menschen).
 * Legt bei Bedarf den Entwurf an; übernimmt nie. Ungültiges wird „nicht zuordenbar“.
 */
export async function POST(req: NextRequest, p: Params) {
  return schreibRoute(req, p, (ctx, deal, autor, body) =>
    vorschlagen(ctx.workspaceId, deal, body.aenderungen, typeof body.zitat === "string" ? body.zitat.slice(0, 300) : null, autor)
  );
}
