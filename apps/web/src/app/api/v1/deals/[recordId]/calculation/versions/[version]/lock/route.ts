import { NextRequest } from "next/server";
import { getAuthContext, unauthorized, success } from "@/lib/api-utils";
import {
  autorAus,
  dealImWorkspace,
  dealNichtGefunden,
  ungueltigeVersion,
  versionAusPfad,
  versionsFehlerAntwort,
} from "@/lib/kalkulation-versionen-antwort";
import { sperren } from "@/services/kalkulation-versionen";

/**
 * POST { bestaetigtSpanne? } → sperrt den Entwurf und schreibt die Quotation des Deals:
 * `{ version, quotation, gueltigkeitHinweis }`. Ablehnungen mit dem Code des Dienstes
 * (PAKETE, STUNDEN, RECHNER_FEHLER, SPANNE: 409; UNGUELTIG: 400; NICHT_GEFUNDEN: 404),
 * Kundenannahme 409 KVA_ACCEPTED.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ recordId: string; version: string }> }) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized(req);
  const { recordId, version: segment } = await params;
  if (!(await dealImWorkspace(ctx.workspaceId, recordId))) return dealNichtGefunden();
  const version = versionAusPfad(segment);
  if (version === null) return ungueltigeVersion();

  const body = (await req.json().catch(() => ({}))) as { bestaetigtSpanne?: unknown } | null;
  try {
    const r = await sperren(ctx.workspaceId, recordId, version, autorAus(ctx), {
      bestaetigtSpanne: body?.bestaetigtSpanne === true,
    });
    return success({ version: r.version, quotation: r.quotation, gueltigkeitHinweis: r.gueltigkeitHinweis });
  } catch (err) {
    const antwort = versionsFehlerAntwort(err);
    if (antwort) return antwort;
    throw err;
  }
}
