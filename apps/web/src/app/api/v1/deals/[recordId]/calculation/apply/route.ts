import { NextRequest } from "next/server";
import { annahmeSperrAntwort } from "@/services/kva-annahme";
import { getAuthContext, unauthorized, badRequest, success } from "@/lib/api-utils";
import { getQuotation, upsertQuotation } from "@/services/quotations";
import { ensureCustomerStatusLink } from "@/services/customer-portal-data";
import { captureScopeSnapshot } from "@/services/scope-guard";
import { completeAgentPriceTasks } from "@/services/agent/agent-tasks";
import { aktuelleKalkulation } from "@/services/rechner/kalkulation";
import { hatPaketoptionen } from "@/services/rechner/pakete";
import { angebotsUebernahme } from "@/services/rechner/uebernahme";

/**
 * POST → übernimmt die aktuelle Kalkulation ins Angebot (Festpreis und
 * Kalkulationsannahmen). Bei einer Spanne nur mit { bestaetigtSpanne: true },
 * dann die Obergrenze. Optional { margeProzent } (30 bis 60): der Preis wird
 * serverseitig aus den gespeicherten Selbstkosten neu gerechnet. Seit 2026-10-08
 * schreibt die Übernahme auch die Posten (Kern + Hebel, Summe = Festpreis), die
 * Leistungen für den KV und die Gültigkeit. Notizen des Angebots bleiben erhalten.
 * Danach dieselben Schritte wie beim normalen Speichern des Angebots.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ recordId: string }> }) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();
  const { recordId } = await params;
  const body = (await req.json().catch(() => ({}))) as { bestaetigtSpanne?: boolean; margeProzent?: unknown };
  // Ein Client-Preis wird nie gelesen. Nicht-numerische Marge (z. B. "25") wird über NaN abgelehnt.
  const margeProzent = typeof body.margeProzent === "number" ? body.margeProzent : body.margeProzent == null ? null : Number.NaN;
  // API-Schlüssel = Agenten; Sitzung = Mensch.
  const uebernommenVon = ctx.authMethod === "api_key" ? "agent" : "mensch";

  if (await hatPaketoptionen(recordId)) {
    return badRequest(
      "Dieser Lead hat Paketoptionen: der Preis kommt aus dem gewählten Paket und würde einen übernommenen Festpreis im Kundenportal überschreiben. Paketpreise anpassen oder die Kalkulation als Orientierung nutzen."
    );
  }
  // Nur eine Kalkulation zur aktuellen Eingabe übernehmen, nie einen veralteten Preis.
  const aktuell = await aktuelleKalkulation(ctx.workspaceId, recordId);
  if (!aktuell.ok) return badRequest(`Kalkulation nicht aktuell: ${aktuell.fehler}`);
  const eigene = aktuell.kalkulation.workspaceId === ctx.workspaceId ? aktuell.kalkulation : null;
  const vorhanden = await getQuotation(recordId);
  const uebernahme = angebotsUebernahme(
    eigene,
    vorhanden ? { notes: vorhanden.notes, isVariable: vorhanden.isVariable, validUntil: vorhanden.validUntil } : null,
    { bestaetigtSpanne: body.bestaetigtSpanne === true, margeProzent, uebernommenVon }
  );
  if (!uebernahme.ok) return badRequest(uebernahme.fehler);

  let data: Awaited<ReturnType<typeof upsertQuotation>>;
  try {
    data = await upsertQuotation(recordId, uebernahme.eingabe);
  } catch (err) {
    const gesperrt = annahmeSperrAntwort(err);
    if (gesperrt) return gesperrt;
    throw err;
  }
  await ensureCustomerStatusLink({ workspaceId: ctx.workspaceId, dealRecordId: recordId, createdBy: ctx.userId }).catch(() => {
    // Darf die Übernahme nicht blockieren (wie beim normalen Speichern).
  });
  await captureScopeSnapshot(ctx.workspaceId, recordId, "issue");
  await completeAgentPriceTasks(ctx.workspaceId, recordId);
  // Hinweis zur Gültigkeit (Umzug bald, Datum vorbei) für die Kalkulationskarte.
  return success({ ...data, gueltigkeitHinweis: uebernahme.gueltigkeitHinweis });
}
