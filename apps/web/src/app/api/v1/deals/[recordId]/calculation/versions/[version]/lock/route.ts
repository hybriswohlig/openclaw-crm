import { NextRequest } from "next/server";
import { badRequest, getAuthContext, unauthorized, success } from "@/lib/api-utils";
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
 * POST { bestaetigtSpanne?, erwartetPreisCent? } → sperrt den Entwurf und schreibt die
 * Quotation des Deals: `{ version, quotation, gueltigkeitHinweis }`. Mit
 * `erwartetPreisCent` (Kalkulationsseite) nur, wenn die Posten genau diesen Preis
 * ergeben, sonst 409 PREIS_GEAENDERT. Ablehnungen mit dem Code des Dienstes
 * (PAKETE, STUNDEN, RECHNER_FEHLER, SPANNE, PREIS_GEAENDERT, UEBERSTEUERUNG_VERWAIST: 409;
 * UNGUELTIG: 400; NICHT_GEFUNDEN: 404), Kundenannahme 409 KVA_ACCEPTED.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ recordId: string; version: string }> }) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized(req);
  const { recordId, version: segment } = await params;
  if (!(await dealImWorkspace(ctx.workspaceId, recordId))) return dealNichtGefunden();
  const version = versionAusPfad(segment);
  if (version === null) return ungueltigeVersion();

  const body = (await req.json().catch(() => ({}))) as { bestaetigtSpanne?: unknown; erwartetPreisCent?: unknown } | null;
  const erwartet = body && "erwartetPreisCent" in body ? body.erwartetPreisCent : undefined;
  if (erwartet !== undefined && !(typeof erwartet === "number" && Number.isSafeInteger(erwartet) && erwartet >= 0)) {
    return badRequest("erwartetPreisCent muss eine ganze Zahl in Cent sein.");
  }
  try {
    const r = await sperren(ctx.workspaceId, recordId, version, autorAus(ctx), {
      bestaetigtSpanne: body?.bestaetigtSpanne === true,
      ...(typeof erwartet === "number" ? { erwartetPreisCent: erwartet } : {}),
    });
    return success({ version: r.version, quotation: r.quotation, gueltigkeitHinweis: r.gueltigkeitHinweis });
  } catch (err) {
    const antwort = versionsFehlerAntwort(err);
    if (antwort) return antwort;
    throw err;
  }
}
