import { NextRequest } from "next/server";
import { success } from "@/lib/api-utils";
import { kvKoerper, kvRoute, pushenSchema, type KvStandParams } from "@/lib/kv-editor-route";
import { pushen } from "@/services/kv-editor";
import { KvEditorFehlerKlasse } from "@/services/kv-editor-fehler";

export const dynamic = "force-dynamic";

/**
 * POST `{ erwartetAktuellDokumentId, annahmeAufhebenBestaetigt? }` → `PushenAntwort` (Spec 7.5).
 * Eine Annahme aufheben darf nur ein Admin (403 `NUR_ADMIN`, Kimi 9); der Dienst prüft es erneut.
 */
export async function POST(req: NextRequest, { params }: KvStandParams) {
  return kvRoute(req, params, async (ctx, deal, wer) => {
    const { standId } = await params;
    const e = await kvKoerper(req, pushenSchema);
    if (e.annahmeAufhebenBestaetigt === true && !wer.admin) throw new KvEditorFehlerKlasse("NUR_ADMIN");
    return success(await pushen(ctx.workspaceId, deal, standId, e, wer));
  });
}
