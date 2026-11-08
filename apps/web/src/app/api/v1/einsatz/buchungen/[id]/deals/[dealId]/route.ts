/**
 * Auftrag einer Transporter-Buchung zuordnen (PUT) oder lösen (DELETE).
 * Falsche Firma und stornierte Buchung: 409. Fremder Deal: 404.
 */
import type { NextRequest } from "next/server";
import { notFound, success } from "@/lib/api-utils";
import { einsatzAutor, einsatzFehler, einsatzVorlauf } from "@/lib/einsatz-route";
import { dealImWorkspace, dealNichtGefunden } from "@/lib/kalkulation-versionen-antwort";
import { loesen, zuordnen } from "@/services/einsatz-buchungen";

type Params = { params: Promise<{ id: string; dealId: string }> };

export async function PUT(req: NextRequest, { params }: Params) {
  const vor = await einsatzVorlauf(req);
  if (vor.antwort) return vor.antwort;
  const { id, dealId } = await params;
  if (!(await dealImWorkspace(vor.ctx.workspaceId, dealId))) return dealNichtGefunden();
  const ergebnis = await zuordnen(vor.ctx.workspaceId, id, dealId, einsatzAutor(vor.ctx));
  if (ergebnis === null) return notFound("Buchung nicht gefunden.");
  if (!ergebnis.ok) {
    const status = ergebnis.code === "FALSCHE_FIRMA" || ergebnis.code === "BUCHUNG_STORNIERT" ? 409 : 400;
    return einsatzFehler(ergebnis.code, status);
  }
  return success({ warnungen: ergebnis.warnungen });
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const vor = await einsatzVorlauf(req);
  if (vor.antwort) return vor.antwort;
  const { dealId } = await params;
  if (!(await dealImWorkspace(vor.ctx.workspaceId, dealId))) return dealNichtGefunden();
  return success({ geloest: await loesen(vor.ctx.workspaceId, dealId) });
}
