/**
 * Einsatz eines Deals (Plan 12a, Entscheidungen 5 und 7). Nur Menschen: jeder
 * API-Schlüssel 403 `NUR_MENSCH`, auch lesend; kein MCP-Werkzeug.
 *
 * GET (`?frisch=1` holt Verkehrsminuten neu) → `{ data: EinsatzAnsicht }`;
 * schreibt nie `deal_employees`.
 * PUT `{ team: TeamWunsch[]; bestaetigtAmTag?: string[] }` → „Team bestätigen“:
 * `{ data: { team } }`, 409 mit Code (`DOPPELT_AM_TAG` samt `konflikte`,
 * `STEMPELT_NOCH`, `DOPPELTE_PERSON`), 400 bei formalen Fehlern.
 */
import { NextResponse, type NextRequest } from "next/server";
import { badRequest, notFound, success } from "@/lib/api-utils";
import type { EinsatzFehlerCode } from "@/lib/einsatz";
import { einsatzAutor, einsatzFehler, einsatzVorlauf, teamAusBody } from "@/lib/einsatz-route";
import { dealImWorkspace } from "@/lib/kalkulation-versionen-antwort";
import { einsatzBestaetigen, ladeEinsatz } from "@/services/einsatz";

type Params = { params: Promise<{ recordId: string }> };

export const dynamic = "force-dynamic";

const FORMAL: ReadonlySet<EinsatzFehlerCode> = new Set(["MEHR_ALS_EIN_LEAD", "MINUTEN_UNGUELTIG", "UNBEKANNT"]);

export async function GET(req: NextRequest, { params }: Params): Promise<NextResponse> {
  const v = await einsatzVorlauf(req);
  if (v.antwort) return v.antwort;
  const { recordId } = await params;
  if (!(await dealImWorkspace(v.ctx.workspaceId, recordId))) return notFound("Deal nicht gefunden");
  const frisch = req.nextUrl.searchParams.get("frisch") === "1";
  return success(await ladeEinsatz(v.ctx.workspaceId, recordId, { frisch }));
}

export async function PUT(req: NextRequest, { params }: Params): Promise<NextResponse> {
  const v = await einsatzVorlauf(req);
  if (v.antwort) return v.antwort;
  const { recordId } = await params;
  if (!(await dealImWorkspace(v.ctx.workspaceId, recordId))) return notFound("Deal nicht gefunden");
  const eingabe = teamAusBody(await req.json().catch(() => null));
  if (!eingabe) return badRequest("Body: { team: [{ employeeId, role, plannedDriveMinutes, plannedWorkMinutes }], bestaetigtAmTag? }");
  const r = await einsatzBestaetigen(v.ctx.workspaceId, recordId, eingabe, einsatzAutor(v.ctx));
  if (r.ok) return success({ team: r.team });
  return einsatzFehler(r.code, FORMAL.has(r.code) ? 400 : 409, r.konflikte ? { konflikte: r.konflikte } : undefined);
}
