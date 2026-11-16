/**
 * Crew-Link einer Person (Crew-Portal). Nur Menschen: jeder API-Schlüssel 403
 * `NUR_MENSCH`, auch lesend (wie die Einsatz-Routen).
 *
 * GET → `{ data: CrewLinkAnsicht | null }`
 * POST → anlegen (idempotent; gesperrter Link bekommt einen neuen Token)
 * PATCH `{ neu: true }` → neuer Token, der alte führt sofort ins Leere
 * DELETE → sperren
 * URL = `${CREW_PORTAL_URL}/l/${token}` (Standard http://localhost:3100).
 */
import { NextResponse, type NextRequest } from "next/server";
import { success } from "@/lib/api-utils";
import { einsatzAutor, einsatzVorlauf } from "@/lib/einsatz-route";
import { crewLinkAnlegen, crewLinkErneuern, crewLinkLesen, crewLinkSperren, type LinkErgebnis } from "@/services/crew/links";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ employeeId: string }> };

function antwort(r: LinkErgebnis, status = 200): NextResponse {
  if (r.ok) return success(r.link, status);
  if (r.code === "INAKTIV") {
    return NextResponse.json({ error: { code: "INAKTIV", message: "Deaktivierte Personen bekommen keinen Crew-Link." } }, { status: 409 });
  }
  return NextResponse.json({ error: { code: "NOT_FOUND", message: "Person nicht gefunden." } }, { status: 404 });
}

export async function GET(req: NextRequest, { params }: Params) {
  const v = await einsatzVorlauf(req);
  if (v.antwort) return v.antwort;
  const { employeeId } = await params;
  return antwort(await crewLinkLesen(v.ctx.workspaceId, employeeId));
}

export async function POST(req: NextRequest, { params }: Params) {
  const v = await einsatzVorlauf(req);
  if (v.antwort) return v.antwort;
  const { employeeId } = await params;
  const r = await crewLinkAnlegen(v.ctx.workspaceId, employeeId, einsatzAutor(v.ctx));
  return antwort(r, r.ok && r.neu ? 201 : 200);
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const v = await einsatzVorlauf(req);
  if (v.antwort) return v.antwort;
  const body = (await req.json().catch(() => null)) as { neu?: unknown } | null;
  if (!body || body.neu !== true) {
    return NextResponse.json({ error: { code: "INVALID_INPUT", message: "Body: { neu: true }" } }, { status: 400 });
  }
  const { employeeId } = await params;
  const r = await crewLinkErneuern(v.ctx.workspaceId, employeeId);
  if (r.ok && r.link === null) {
    return NextResponse.json({ error: { code: "NOT_FOUND", message: "Noch kein Crew-Link." } }, { status: 404 });
  }
  return antwort(r);
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const v = await einsatzVorlauf(req);
  if (v.antwort) return v.antwort;
  const { employeeId } = await params;
  return antwort(await crewLinkSperren(v.ctx.workspaceId, employeeId));
}
