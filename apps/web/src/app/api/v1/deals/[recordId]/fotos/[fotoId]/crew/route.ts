/**
 * „Für Crew freigeben“ an einem Foto des Deals (Chat-Anhang, Agenten-Foto oder
 * Einsatz-Foto). PATCH `{ freigegeben: boolean }` → `{ data: { crewFreigegebenAt } }`.
 * Nur Menschen (API-Schlüssel 403 `NUR_MENSCH`).
 */
import { NextResponse, type NextRequest } from "next/server";
import { notFound, success } from "@/lib/api-utils";
import { einsatzAutor, einsatzVorlauf } from "@/lib/einsatz-route";
import { dealImWorkspace } from "@/lib/kalkulation-versionen-antwort";
import { crewFotoFreigeben } from "@/services/crew/fotos";

export const dynamic = "force-dynamic";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ recordId: string; fotoId: string }> }) {
  const v = await einsatzVorlauf(req);
  if (v.antwort) return v.antwort;
  const { recordId, fotoId } = await params;
  if (!(await dealImWorkspace(v.ctx.workspaceId, recordId))) return notFound("Deal nicht gefunden");
  const body = (await req.json().catch(() => null)) as { freigegeben?: unknown } | null;
  if (!body || typeof body.freigegeben !== "boolean") {
    return NextResponse.json({ error: { code: "INVALID_INPUT", message: "Body: { freigegeben: boolean }" } }, { status: 400 });
  }
  const r = await crewFotoFreigeben(v.ctx.workspaceId, recordId, fotoId, body.freigegeben, einsatzAutor(v.ctx));
  if (r.ok) return success({ crewFreigegebenAt: r.crewFreigegebenAt });
  if (r.code === "KEIN_BILD") {
    return NextResponse.json({ error: { code: "KEIN_BILD", message: "Nur Bilder lassen sich freigeben." } }, { status: 400 });
  }
  return notFound("Foto nicht gefunden");
}
