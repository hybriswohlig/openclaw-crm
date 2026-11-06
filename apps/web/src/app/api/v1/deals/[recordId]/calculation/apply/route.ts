import { NextRequest } from "next/server";
import { annahmeSperrAntwort } from "@/services/kva-annahme";
import { getAuthContext, unauthorized, badRequest, success } from "@/lib/api-utils";
import { UebersteuerungFehler } from "@/lib/kalkulation-versionen";
import { hatPaketoptionen } from "@/services/rechner/pakete";
import { MARGE_MAX_PROZENT, MARGE_MIN_PROZENT } from "@/services/rechner/marge";
import {
  entwurfHolenOderAnlegen,
  kartenAbweichung,
  kartenAbweichungText,
  sperren,
  uebersteuern,
  VersionsFehler,
  wirksamerWert,
  type Autor,
} from "@/services/kalkulation-versionen";

const MARGE_ZURUECK = "Kalkulationskarte ohne Margenwahl: Vorschlag des Rechners";

/**
 * POST → übernimmt die Kalkulation ins Angebot, seit Plan 2 über eine
 * Kalkulationsversion: Entwurf holen (oder anlegen), optional die Marge aus dem
 * Regler als Übersteuerung ({ margeProzent }, 30 bis 60; der Rechner rechnet
 * den Preis), dann sperren. Ohne Margenwahl gilt wie auf der Karte angezeigt der
 * Vorschlag des Rechners: eine geerbte Marge-Übersteuerung wird dafür aufgehoben. Das Sperren schreibt Festpreis, Posten, Leistungen
 * und Gültigkeit in die Quotation des Deals (eine Transaktion) und macht danach
 * dieselben Schritte wie das normale Speichern des Angebots. Bei einer Spanne
 * nur mit { bestaetigtSpanne: true }, dann die Obergrenze. Notizen bleiben.
 * Hat der Entwurf (ohne Entwurf: die letzte gesperrte Version) wirksame Anpassungen
 * außer der Marge, lehnt die Route vor jeder Änderung ab: die Karte zeigt sie nicht.
 * Antwort wie bisher: { ...quotation, gueltigkeitHinweis }. Jede Ablehnung ist
 * 400, nur die Kundenannahme 409 (KVA_ACCEPTED).
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ recordId: string }> }) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized(req);
  const { recordId } = await params;
  const body = (await req.json().catch(() => ({}))) as { bestaetigtSpanne?: boolean; margeProzent?: unknown };
  // Ein Client-Preis wird nie gelesen. Nicht-numerische Marge (z. B. "25") wird über NaN abgelehnt.
  const margeProzent = typeof body.margeProzent === "number" ? body.margeProzent : body.margeProzent == null ? null : Number.NaN;
  // API-Schlüssel = Agenten; Sitzung = Mensch.
  const autor: Autor = { userId: ctx.userId, quelle: ctx.authMethod === "api_key" ? "agent" : "mensch" };

  // Vor jeder Nebenwirkung (kein Entwurf, keine Meldung an den Rechner).
  if (await hatPaketoptionen(recordId)) {
    return badRequest(
      "Dieser Lead hat Paketoptionen: der Preis kommt aus dem gewählten Paket und würde einen übernommenen Festpreis im Kundenportal überschreiben. Paketpreise anpassen oder die Kalkulation als Orientierung nutzen."
    );
  }
  // Die Karte zeigt die Live-Kalkulation. Übernehmen würde aber den Entwurf (oder die
  // geerbten Übersteuerungen der letzten Sperre) rechnen: mit Anpassungen außer der
  // Marge wäre das ein Preis, den niemand gesehen hat. Dann nur über die Version.
  const abweichung = await kartenAbweichung(ctx.workspaceId, recordId);
  if (abweichung) {
    return badRequest(kartenAbweichungText(abweichung.version));
  }
  if (margeProzent !== null && (!Number.isFinite(margeProzent) || margeProzent < MARGE_MIN_PROZENT || margeProzent > MARGE_MAX_PROZENT)) {
    return badRequest(`Marge muss zwischen ${MARGE_MIN_PROZENT} und ${MARGE_MAX_PROZENT} % liegen.`);
  }

  try {
    let { version } = await entwurfHolenOderAnlegen(ctx.workspaceId, recordId, autor);
    const geltendeMarge = wirksamerWert(version.overrides ?? [], "marge", "marge");
    // Dieselbe Marge noch einmal (Wiederholung nach Ablehnung, Regler unverändert): keine neue Übersteuerung.
    if (margeProzent !== null && margeProzent !== geltendeMarge) {
      ({ version } = await uebersteuern(
        ctx.workspaceId,
        recordId,
        version.version,
        { art: "marge", key: "marge", wert: margeProzent, grund: "Marge im Regler gewählt" },
        autor
      ));
    } else if (margeProzent === null && geltendeMarge !== null) {
      ({ version } = await uebersteuern(
        ctx.workspaceId,
        recordId,
        version.version,
        { art: "marge", key: "marge", wert: null, grund: MARGE_ZURUECK },
        autor
      ));
    }
    const r = await sperren(ctx.workspaceId, recordId, version.version, autor, {
      bestaetigtSpanne: body.bestaetigtSpanne === true,
      nurMarge: true,
    });
    // Hinweis zur Gültigkeit (Umzug bald, Datum vorbei) für die Kalkulationskarte.
    return success({ ...(r.quotation ?? {}), gueltigkeitHinweis: r.gueltigkeitHinweis });
  } catch (err) {
    const gesperrt = annahmeSperrAntwort(err);
    if (gesperrt) return gesperrt;
    if (err instanceof VersionsFehler || err instanceof UebersteuerungFehler) return badRequest(err.message);
    throw err;
  }
}
