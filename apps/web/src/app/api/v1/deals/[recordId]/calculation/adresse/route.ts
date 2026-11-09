import { NextRequest } from "next/server";
import { badRequest, forbidden, getAuthContext, isReadOnlyApiKey, success, unauthorized } from "@/lib/api-utils";
import { dealImWorkspace, dealNichtGefunden } from "@/lib/kalkulation-versionen-antwort";
import { AdressFehler, adresseInsLead, pruefeAdressEingabe } from "@/services/kalkulation-adresse";

/**
 * PUT `{ seite: "beladen" | "entladen", adresse, quelle?: "kalkulation" | "chat", version? }`
 * schreibt die Adresse ins Lead (Plan 15, Bauteile 2 und 8). Die Seite fragt vorher
 * nach, weil es die Lead-Daten ändert, und rechnet danach neu. Nicht für Nur-Lese-Schlüssel.
 */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ recordId: string }> }) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized(req);
  if (isReadOnlyApiKey(ctx)) return forbidden("Nur-Lese-Schlüssel darf keine Adresse schreiben.");
  const { recordId } = await params;
  if (!(await dealImWorkspace(ctx.workspaceId, recordId))) return dealNichtGefunden();
  try {
    const e = pruefeAdressEingabe(await req.json().catch(() => null));
    await adresseInsLead(ctx.workspaceId, recordId, e, ctx.userId ?? null);
    return success({ ok: true, seite: e.seite, adresse: e.adresse });
  } catch (err) {
    if (err instanceof AdressFehler) return badRequest(err.message);
    throw err;
  }
}
