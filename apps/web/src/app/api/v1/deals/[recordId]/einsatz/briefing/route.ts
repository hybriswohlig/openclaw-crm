/**
 * Briefing fürs Crew-Portal aus dem Einsatz-Dialog. Nur Menschen: jeder
 * API-Schlüssel 403 `NUR_MENSCH`.
 *
 * GET → `{ data: BriefingStand }`.
 * POST `{ aktion: "freigeben", whatsapp: boolean }` gibt (erneut) frei und schickt
 * auf Wunsch jeder Person im Team einmal den Link; ohne Team 409 `KEIN_TEAM`.
 * POST `{ aktion: "zurueckziehen" }` nimmt es aus dem Portal.
 */
import { NextResponse, type NextRequest } from "next/server";
import { badRequest, notFound, success } from "@/lib/api-utils";
import { einsatzAutor, einsatzVorlauf } from "@/lib/einsatz-route";
import { dealImWorkspace } from "@/lib/kalkulation-versionen-antwort";
import { briefingFreigeben, briefingStandLesen, briefingZurueckziehen } from "@/services/crew/briefing-freigabe";

type Params = { params: Promise<{ recordId: string }> };

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: Params): Promise<NextResponse> {
  const v = await einsatzVorlauf(req);
  if (v.antwort) return v.antwort;
  const { recordId } = await params;
  if (!(await dealImWorkspace(v.ctx.workspaceId, recordId))) return notFound("Deal nicht gefunden");
  return success(await briefingStandLesen(v.ctx.workspaceId, recordId));
}

export async function POST(req: NextRequest, { params }: Params): Promise<NextResponse> {
  const v = await einsatzVorlauf(req);
  if (v.antwort) return v.antwort;
  const { recordId } = await params;
  if (!(await dealImWorkspace(v.ctx.workspaceId, recordId))) return notFound("Deal nicht gefunden");
  const body = (await req.json().catch(() => null)) as { aktion?: unknown; whatsapp?: unknown } | null;
  if (body?.aktion === "zurueckziehen") return success(await briefingZurueckziehen(v.ctx.workspaceId, recordId));
  if (body?.aktion !== "freigeben" || typeof body.whatsapp !== "boolean") {
    return badRequest('Body: { aktion: "freigeben", whatsapp: true|false } oder { aktion: "zurueckziehen" }');
  }
  const r = await briefingFreigeben(v.ctx.workspaceId, recordId, { whatsapp: body.whatsapp }, einsatzAutor(v.ctx));
  if (!r.ok) {
    return NextResponse.json(
      { error: { code: "KEIN_TEAM", message: "Erst das Team bestätigen, dann das Briefing freigeben." } },
      { status: 409 },
    );
  }
  return success(r.stand);
}
