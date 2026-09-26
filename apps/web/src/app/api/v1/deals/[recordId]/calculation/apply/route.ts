import { NextRequest } from "next/server";
import { getAuthContext, unauthorized, badRequest, success } from "@/lib/api-utils";
import { getQuotation, upsertQuotation } from "@/services/quotations";
import { ensureCustomerStatusLink } from "@/services/customer-portal-data";
import { captureScopeSnapshot } from "@/services/scope-guard";
import { completeAgentPriceTasks } from "@/services/agent/agent-tasks";
import { dbSpeicher } from "@/services/rechner/speicher";
import { angebotsUebernahme } from "@/services/rechner/uebernahme";

/**
 * POST → übernimmt die gespeicherte Kalkulation ins Angebot (Festpreis und
 * Kalkulationsannahmen). Bei einer Spanne nur mit { bestaetigtSpanne: true },
 * dann die Obergrenze. Positionen und Notizen des Angebots bleiben erhalten.
 * Danach dieselben Schritte wie beim normalen Speichern des Angebots.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ recordId: string }> }) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();
  const { recordId } = await params;
  const body = (await req.json().catch(() => ({}))) as { bestaetigtSpanne?: boolean };

  const zeile = await dbSpeicher.lesen(recordId);
  const eigene = zeile && zeile.workspaceId === ctx.workspaceId ? zeile : null;
  const vorhanden = await getQuotation(recordId);
  const uebernahme = angebotsUebernahme(
    eigene,
    vorhanden ? { notes: vorhanden.notes, isVariable: vorhanden.isVariable } : null,
    { bestaetigtSpanne: body.bestaetigtSpanne === true }
  );
  if (!uebernahme.ok) return badRequest(uebernahme.fehler);

  const data = await upsertQuotation(recordId, uebernahme.eingabe);
  await ensureCustomerStatusLink({ workspaceId: ctx.workspaceId, dealRecordId: recordId, createdBy: ctx.userId }).catch(() => {
    // Darf die Übernahme nicht blockieren (wie beim normalen Speichern).
  });
  await captureScopeSnapshot(ctx.workspaceId, recordId, "issue");
  await completeAgentPriceTasks(ctx.workspaceId, recordId);
  return success(data);
}
