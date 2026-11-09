/**
 * Karte des Einsatzes (Plan 12c). Nur Menschen: jeder API-Schlüssel 403
 * `NUR_MENSCH`. GET → `{ data: EinsatzKarte }`. Schreibt nie `deal_employees`.
 */
import { NextResponse, type NextRequest } from "next/server";
import { notFound, success } from "@/lib/api-utils";
import { einsatzVorlauf } from "@/lib/einsatz-route";
import { dealImWorkspace } from "@/lib/kalkulation-versionen-antwort";
import { ladeEinsatzKarte } from "@/services/einsatz-karte";

type Params = { params: Promise<{ recordId: string }> };

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: Params): Promise<NextResponse> {
  const v = await einsatzVorlauf(req);
  if (v.antwort) return v.antwort;
  const { recordId } = await params;
  if (!(await dealImWorkspace(v.ctx.workspaceId, recordId))) return notFound("Deal nicht gefunden");
  return success(await ladeEinsatzKarte(v.ctx.workspaceId, recordId));
}
