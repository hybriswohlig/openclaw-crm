import { NextRequest } from "next/server";
import { schreibRoute, type Params } from "@/lib/angebot-aenderung-antwort";
import { ausEingabe } from "@/services/angebot-aenderung";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** POST { text } → „Was soll sich ändern?“ (nur Menschen): Verlauf plus Text, die Liste der Eingabe-Vorschläge wird ersetzt. */
export async function POST(req: NextRequest, p: Params) {
  return schreibRoute(req, p, (ctx, deal, autor, body) => ausEingabe(ctx.workspaceId, deal, typeof body.text === "string" ? body.text : "", autor));
}
