import { NextRequest } from "next/server";
import { badRequest, forbidden, getAuthContext, isReadOnlyApiKey, notFound, success, unauthorized } from "@/lib/api-utils";
import { pruefeKundeEingabe } from "@/lib/deal-kunde";
import { KundeFehler, ladeKunde, speichereKunde } from "@/services/deal-kunde";

export const dynamic = "force-dynamic";

/** GET: Kunde und Adressen des Deals (Akte, Vorprüfung vor KV/AB/RE). */
export async function GET(req: NextRequest, { params }: { params: Promise<{ recordId: string }> }) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized(req);
  const { recordId } = await params;
  const kunde = await ladeKunde(ctx.workspaceId, recordId);
  if (!kunde) return notFound("Deal nicht gefunden");
  return success(kunde);
}

/**
 * PUT `{ name?, telefon?, email?, auszug?: { strasse, plz, ort }, einzug?, datum?, quelle? }`:
 * speichert nur die mitgeschickten Felder (Lead bzw. verknüpfte Person, `updateRecord`
 * wie die Akte). Leeren geht hier nicht. Nicht für Nur-Lese-Schlüssel.
 */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ recordId: string }> }) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized(req);
  if (isReadOnlyApiKey(ctx)) return forbidden("Nur-Lese-Schlüssel darf Kundendaten nicht ändern.");
  const { recordId } = await params;
  try {
    const eingabe = pruefeKundeEingabe(await req.json().catch(() => null));
    if (!(await ladeKunde(ctx.workspaceId, recordId))) return notFound("Deal nicht gefunden");
    return success(await speichereKunde(ctx.workspaceId, recordId, eingabe, ctx.userId ?? null));
  } catch (err) {
    if (err instanceof KundeFehler) return badRequest(err.message);
    throw err;
  }
}
