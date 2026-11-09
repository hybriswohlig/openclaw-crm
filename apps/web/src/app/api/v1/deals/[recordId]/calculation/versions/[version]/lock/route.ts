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
 * POST { bestaetigtSpanne?, erwartetPreisCent?, erwartetPreisHash?, modusWechselBestaetigt? } →
 * sperrt den Entwurf und schreibt die Quotation des Deals (bei Firmen mit Schalter auch
 * Paketoptionen und Terminangebote, eine Transaktion): `{ version, quotation, gueltigkeitHinweis }`.
 * Mit `erwartetPreisCent` nur, wenn der Preis der Standardwahl genau dieser ist, mit
 * `erwartetPreisHash` (`preisHash` der Seite) nur, wenn alle Kundenpreise gleich sind,
 * sonst 409 PREIS_GEAENDERT. `modusWechselBestaetigt`: ein Mensch bestätigt, dass aus
 * einem Stunden-KV ein Festpreis wird (sonst 409 MODUSWECHSEL); für Agenten zählt es nicht.
 * Ablehnungen mit dem Code des Dienstes (PAKETE, STUNDEN, RECHNER_FEHLER, SPANNE,
 * PREIS_GEAENDERT, UEBERSTEUERUNG_VERWAIST und die Plan-5b-Codes: 409; UNGUELTIG: 400;
 * NICHT_GEFUNDEN: 404), Kundenannahme 409 KVA_ACCEPTED.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ recordId: string; version: string }> }) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized(req);
  const { recordId, version: segment } = await params;
  if (!(await dealImWorkspace(ctx.workspaceId, recordId))) return dealNichtGefunden();
  const version = versionAusPfad(segment);
  if (version === null) return ungueltigeVersion();

  const body = (await req.json().catch(() => ({}))) as {
    bestaetigtSpanne?: unknown;
    erwartetPreisCent?: unknown;
    erwartetPreisHash?: unknown;
    modusWechselBestaetigt?: unknown;
    ohneAdresseBestaetigt?: unknown;
  } | null;
  const erwartet = body && "erwartetPreisCent" in body ? body.erwartetPreisCent : undefined;
  if (erwartet !== undefined && !(typeof erwartet === "number" && Number.isSafeInteger(erwartet) && erwartet >= 0)) {
    return badRequest("erwartetPreisCent muss eine ganze Zahl in Cent sein.");
  }
  const hash = body && "erwartetPreisHash" in body ? body.erwartetPreisHash : undefined;
  if (hash !== undefined && !(typeof hash === "string" && hash.length > 0 && hash.length <= 20_000)) {
    return badRequest("erwartetPreisHash muss ein Text sein.");
  }
  try {
    const r = await sperren(ctx.workspaceId, recordId, version, autorAus(ctx), {
      bestaetigtSpanne: body?.bestaetigtSpanne === true,
      ...(typeof erwartet === "number" ? { erwartetPreisCent: erwartet } : {}),
      ...(typeof hash === "string" ? { erwartetPreisHash: hash } : {}),
      ...(body?.modusWechselBestaetigt === true ? { modusWechselBestaetigt: true } : {}),
      // Plan 15 (Bauteil 5): „Preis ohne echte Fahrzeiten“ bestätigt (nur Menschen; ein Agent bekommt 409 ADRESSE_FEHLT).
      ...(body?.ohneAdresseBestaetigt === true ? { ohneAdresseBestaetigt: true } : {}),
    });
    return success({ version: r.version, quotation: r.quotation, gueltigkeitHinweis: r.gueltigkeitHinweis });
  } catch (err) {
    const antwort = versionsFehlerAntwort(err);
    if (antwort) return antwort;
    throw err;
  }
}
