/**
 * Ausschreibung im Crew-Portal aus dem Einsatz-Dialog. Nur Menschen: jeder
 * API-Schlüssel 403 `NUR_MENSCH`.
 *
 * PATCH `{ leute?: 1..50 | null, ausschreiben?: boolean }` → `{ data: CrewAusschreibung }`.
 * `leute: null` löscht die Zahl am Auftrag (dann gilt die Kalkulation).
 */
import { NextResponse, type NextRequest } from "next/server";
import { badRequest, notFound, success } from "@/lib/api-utils";
import { einsatzAutor, einsatzVorlauf } from "@/lib/einsatz-route";
import { dealImWorkspace } from "@/lib/kalkulation-versionen-antwort";
import { ausschreibungEingabe, crewAusschreibungSetzen } from "@/services/crew/ausschreibung";

type Params = { params: Promise<{ recordId: string }> };

export const dynamic = "force-dynamic";

export async function PATCH(req: NextRequest, { params }: Params): Promise<NextResponse> {
  const v = await einsatzVorlauf(req);
  if (v.antwort) return v.antwort;
  const { recordId } = await params;
  if (!(await dealImWorkspace(v.ctx.workspaceId, recordId))) return notFound("Deal nicht gefunden");
  const eingabe = ausschreibungEingabe(await req.json().catch(() => null));
  if (!eingabe) return badRequest("Body: { leute?: 1 bis 50 oder null, ausschreiben?: true oder false }");
  const r = await crewAusschreibungSetzen(v.ctx.workspaceId, recordId, eingabe, einsatzAutor(v.ctx));
  if (!r.ok) {
    return NextResponse.json(
      { error: { code: "KEIN_AUFTRAG", message: "Zu diesem Deal gibt es noch keinen Auftrag. Einmal die Akte öffnen, dann geht es." } },
      { status: 409 },
    );
  }
  return success(r.wert);
}
