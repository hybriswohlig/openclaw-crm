import { NextRequest } from "next/server";
import { getAuthContext, unauthorized, success, badRequest, forbidden } from "@/lib/api-utils";
import { abweichungenVonAnnahme, annahmeAufheben, annahmeAusZeile, ladeAktiveAnnahme } from "@/services/kva-annahme";
import { bestaetigungVerschickt } from "@/services/kva-bestaetigung";
import { ladeUmzugsrahmen } from "@/services/customer-portal-data";
import { ladeLetztenWiderruf } from "@/services/kva-widerruf";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: Promise<{ recordId: string }> }) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();
  const { recordId } = await params;
  const row = await ladeAktiveAnnahme(recordId);
  if (!row || row.workspaceId !== ctx.workspaceId) {
    // Kein aktiver Vertrag: Hat der Kunde über das Portal widerrufen, sieht das Team es hier.
    const w = row ? null : await ladeLetztenWiderruf(recordId);
    const widerrufen =
      w && w.workspaceId === ctx.workspaceId
        ? {
            eingegangenAt: w.eingegangenAt.toISOString(),
            name: w.name,
            bestaetigt: !!w.bestaetigungSentAt && !!w.bestaetigungKanaele && w.bestaetigungKanaele !== "sending",
          }
        : null;
    return success({ aktiv: null, widerrufen });
  }
  const aktuell = await ladeUmzugsrahmen(ctx.workspaceId, recordId);
  return success({
    aktiv: {
      ...annahmeAusZeile(row),
      versicherungGewuenscht: row.versicherungGewuenscht,
      confirmationSentAt: bestaetigungVerschickt(row) ? row.confirmationSentAt!.toISOString() : null,
      moveDate: row.moveDate,
      abweichungen: abweichungenVonAnnahme(
        { moveDate: row.moveDate, fromAddress: row.fromAddress, toAddress: row.toAddress },
        aktuell
      ),
    },
    darfAufheben: ctx.workspaceRole === "admin",
  });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ recordId: string }> }) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();
  if (ctx.workspaceRole !== "admin") return forbidden("Nur Admins können eine Annahme aufheben.");
  const { recordId } = await params;
  const body = (await req.json().catch(() => ({}))) as { grund?: unknown };
  const grund = typeof body.grund === "string" ? body.grund.trim() : "";
  if (grund.length < 3) return badRequest("Bitte einen Grund angeben.");
  const status = await annahmeAufheben({ workspaceId: ctx.workspaceId, dealRecordId: recordId, userId: ctx.userId, grund });
  return success({ status });
}
