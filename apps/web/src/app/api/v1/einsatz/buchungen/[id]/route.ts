/**
 * PATCH einer Transporter-Buchung. Storniert ist Endzustand (409), ungültiger
 * Zeitraum 400, fremde oder fehlende Buchung 404.
 */
import type { NextRequest } from "next/server";
import { badRequest, notFound, success } from "@/lib/api-utils";
import { einsatzAutor, einsatzFehler, einsatzVorlauf } from "@/lib/einsatz-route";
import { buchungAendern } from "@/services/einsatz-buchungen";
import { buchungPatch } from "../eingabe";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, { params }: Params) {
  const vor = await einsatzVorlauf(req);
  if (vor.antwort) return vor.antwort;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest("Ungültiges JSON.");
  }
  const eingabe = buchungPatch(body);
  if (!eingabe) return badRequest("Die Angaben zur Buchung sind unvollständig oder ungültig.");
  const { id } = await params;
  const ergebnis = await buchungAendern(vor.ctx.workspaceId, id, eingabe, einsatzAutor(vor.ctx));
  if (ergebnis === null) return notFound("Buchung nicht gefunden.");
  if ("fehler" in ergebnis) {
    const status = ergebnis.fehler === "BUCHUNG_STORNIERT" ? 409 : 400;
    return einsatzFehler(ergebnis.fehler, status);
  }
  return success({ buchung: ergebnis.buchung, warnungen: ergebnis.warnungen });
}
