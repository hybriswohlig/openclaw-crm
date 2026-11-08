import { type NextRequest } from "next/server";
import { success } from "@/lib/api-utils";
import { pruefeStammdaten } from "@/lib/einsatz";
import { einsatzFehler, einsatzVorlauf } from "@/lib/einsatz-route";
import { ladePersonen, personAnlegen } from "@/services/einsatz-personen";
import { liesJson, stammdatenAus } from "./eingabe";

export async function GET(req: NextRequest) {
  const vor = await einsatzVorlauf(req);
  if (vor.antwort) return vor.antwort;
  return success(await ladePersonen(vor.ctx.workspaceId));
}

export async function POST(req: NextRequest) {
  const vor = await einsatzVorlauf(req);
  if (vor.antwort) return vor.antwort;
  const gelesen = await liesJson(req);
  if ("antwort" in gelesen) return gelesen.antwort;
  const eingabe = stammdatenAus(gelesen.body);
  if (!eingabe) return einsatzFehler("STAMMDATEN_UNGUELTIG", 400);
  const fehler = pruefeStammdaten(eingabe, true);
  if (fehler) return einsatzFehler("STAMMDATEN_UNGUELTIG", 400, { feld: fehler });
  return success(await personAnlegen(vor.ctx.workspaceId, eingabe), 201);
}
