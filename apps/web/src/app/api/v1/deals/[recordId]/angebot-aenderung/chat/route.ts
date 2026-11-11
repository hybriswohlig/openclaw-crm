import { NextRequest } from "next/server";
import { schreibRoute, type Params } from "@/lib/angebot-aenderung-antwort";
import { ausChat } from "@/services/angebot-aenderung";

export const dynamic = "force-dynamic";
/** KI bis 90 s (Zeitgrenze im Dienst), dazu Laden. */
export const maxDuration = 120;

/** POST → „Aus dem Chat“ (nur Menschen): neue Kundennachrichten seit dem Angebot als Vorschläge. */
export async function POST(req: NextRequest, p: Params) {
  return schreibRoute(req, p, (ctx, deal, autor) => ausChat(ctx.workspaceId, deal, autor));
}
