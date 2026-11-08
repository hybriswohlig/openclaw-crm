import { type NextRequest } from "next/server";
import { notFound, success } from "@/lib/api-utils";
import { pruefeStammdaten } from "@/lib/einsatz";
import { einsatzFehler, einsatzVorlauf } from "@/lib/einsatz-route";
import { personAendern } from "@/services/einsatz-personen";
import { liesJson, stammdatenAus } from "../eingabe";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ employeeId: string }> }) {
  const vor = await einsatzVorlauf(req);
  if (vor.antwort) return vor.antwort;
  const gelesen = await liesJson(req);
  if ("antwort" in gelesen) return gelesen.antwort;
  const eingabe = stammdatenAus(gelesen.body);
  if (!eingabe) return einsatzFehler("STAMMDATEN_UNGUELTIG", 400);
  const fehler = pruefeStammdaten(eingabe, false);
  if (fehler) return einsatzFehler("STAMMDATEN_UNGUELTIG", 400, { feld: fehler });
  const { employeeId } = await params;
  const person = await personAendern(vor.ctx.workspaceId, employeeId, eingabe);
  if (!person) return notFound();
  return success(person);
}
