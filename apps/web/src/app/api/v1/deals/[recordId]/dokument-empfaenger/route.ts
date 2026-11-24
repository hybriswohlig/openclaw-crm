/**
 * Auftraggeber auf Dokumenten und Anrede Sie/Du am Deal.
 * JSON-Attribut, keine Migration. Der Kontakt (WhatsApp) bleibt unberührt.
 *
 *   GET  /api/v1/deals/[recordId]/dokument-empfaenger
 *   PUT  /api/v1/deals/[recordId]/dokument-empfaenger
 */
import { NextRequest } from "next/server";
import { badRequest, getAuthContext, notFound, success, unauthorized } from "@/lib/api-utils";
import { dealImWorkspace, dealNichtGefunden } from "@/lib/kalkulation-versionen-antwort";
import { liesDokumentEmpfaenger, speichereDokumentEmpfaenger } from "@/services/dokument-empfaenger";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: Promise<{ recordId: string }> }) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized(req);
  const { recordId } = await params;
  if (!(await dealImWorkspace(ctx.workspaceId, recordId))) return dealNichtGefunden();
  return success(await liesDokumentEmpfaenger(ctx.workspaceId, recordId));
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ recordId: string }> }) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized(req);
  const { recordId } = await params;
  if (!(await dealImWorkspace(ctx.workspaceId, recordId))) return dealNichtGefunden();
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest("Invalid JSON body");
  }
  const ergebnis = await speichereDokumentEmpfaenger(ctx.workspaceId, recordId, body, ctx.userId);
  if (!ergebnis.ok) {
    if ("fehlt" in ergebnis && ergebnis.fehlt) return notFound(ergebnis.fehler);
    return badRequest(ergebnis.fehler);
  }
  return success(ergebnis.wert);
}
