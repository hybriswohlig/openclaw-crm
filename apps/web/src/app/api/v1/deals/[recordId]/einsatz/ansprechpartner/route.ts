/**
 * Ansprechpartner fürs Team (Crew-Portal) aus dem Einsatz-Dialog. Nur Menschen:
 * jeder API-Schlüssel 403 `NUR_MENSCH`.
 *
 * PUT `{ employeeId: string | null, alsStandard?: boolean }` → `{ data: AnsprechpartnerAnsicht }`.
 * `employeeId: null` nimmt den Eintrag am Job zurück (dann gilt der Standard).
 * Nur aktive Mitarbeiter mit Telefonnummer, sonst 400.
 */
import { NextResponse, type NextRequest } from "next/server";
import { badRequest, notFound, success } from "@/lib/api-utils";
import { einsatzAutor, einsatzVorlauf } from "@/lib/einsatz-route";
import { dealImWorkspace } from "@/lib/kalkulation-versionen-antwort";
import { ansprechpartnerSetzen } from "@/services/crew/ansprechpartner";

type Params = { params: Promise<{ recordId: string }> };

export const dynamic = "force-dynamic";

export async function PUT(req: NextRequest, { params }: Params): Promise<NextResponse> {
  const v = await einsatzVorlauf(req);
  if (v.antwort) return v.antwort;
  const { recordId } = await params;
  if (!(await dealImWorkspace(v.ctx.workspaceId, recordId))) return notFound("Deal nicht gefunden");
  const body = (await req.json().catch(() => null)) as { employeeId?: unknown; alsStandard?: unknown } | null;
  const id = body?.employeeId;
  if (!body || !(id === null || (typeof id === "string" && id.length > 0 && id.length <= 64)) || !(body.alsStandard === undefined || typeof body.alsStandard === "boolean")) {
    return badRequest("Body: { employeeId: string | null, alsStandard?: boolean }");
  }
  const r = await ansprechpartnerSetzen(v.ctx.workspaceId, recordId, { employeeId: id as string | null, alsStandard: body.alsStandard === true }, einsatzAutor(v.ctx));
  if (!r.ok) return badRequest("Nur aktive Mitarbeiter mit Telefonnummer können Ansprechpartner sein.");
  return success(r.wert);
}
