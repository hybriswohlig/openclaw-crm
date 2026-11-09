import { NextRequest } from "next/server";
import { badRequest, forbidden, getAuthContext, success, unauthorized } from "@/lib/api-utils";
import { dealImWorkspace, dealNichtGefunden } from "@/lib/kalkulation-versionen-antwort";
import { paketeAnbietenSetzen, paketSchalter } from "@/services/plan5-schalter";

/**
 * Plan 15, Bauteil 15: „Pakete anbieten“ je Deal.
 * GET → `PaketSchalter` (Firmenstandard, Wert am Deal, wirksam, aktive Pakete).
 * PUT `{ wert: "standard" | "an" | "aus" }` → setzt den Wert am Deal. Nur Menschen
 * (ein API-Schlüssel bekommt 403); die Seite fragt beim Einschalten nach, weil der
 * Kunde danach Paketkarten sieht. Gilt ab dem nächsten Rechnen bzw. Entwurf.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ recordId: string }> }) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized(req);
  const { recordId } = await params;
  if (!(await dealImWorkspace(ctx.workspaceId, recordId))) return dealNichtGefunden();
  return success(await paketSchalter(ctx.workspaceId, recordId));
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ recordId: string }> }) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized(req);
  if (ctx.authMethod === "api_key") return forbidden("Pakete schaltet nur ein Mensch.");
  const { recordId } = await params;
  if (!(await dealImWorkspace(ctx.workspaceId, recordId))) return dealNichtGefunden();
  const body = (await req.json().catch(() => null)) as { wert?: unknown } | null;
  const wert = body?.wert;
  if (wert !== "standard" && wert !== "an" && wert !== "aus") return badRequest("wert muss standard, an oder aus sein");
  await paketeAnbietenSetzen(recordId, wert === "standard" ? null : wert);
  return success(await paketSchalter(ctx.workspaceId, recordId));
}
