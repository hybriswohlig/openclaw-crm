/**
 * Gemeinsamer Vorlauf der schreibenden Zahlungsrouten aus Plan 9 (Storno,
 * Korrektur, Bar erhalten): angemeldet, Mensch (kein API-Schlüssel), Deal im
 * Workspace. Geld-Fehler als `{ error: { code, message } }` mit ihrem Status.
 */
import { NextRequest, NextResponse } from "next/server";
import { forbidden, getAuthContext, isReadOnlyApiKey, notFound, unauthorized, type AuthContext } from "@/lib/api-utils";
import { dealImWorkspace, dealNichtGefunden } from "@/lib/kalkulation-versionen-antwort";
import { GeldFehler } from "@/lib/geld";

export type Vorlauf = { antwort: NextResponse } | { antwort: null; ctx: AuthContext; recordId: string };

export async function menschMitDeal(req: NextRequest, recordId: string): Promise<Vorlauf> {
  const ctx = await getAuthContext(req);
  if (!ctx) return { antwort: unauthorized(req) };
  if (isReadOnlyApiKey(ctx)) return { antwort: forbidden("Nur-Lese-Schlüssel darf Zahlungen nicht ändern.") };
  if (ctx.authMethod === "api_key") return { antwort: forbidden("Zahlungen ändert nur ein Mensch.") };
  if (!(await dealImWorkspace(ctx.workspaceId, recordId))) return { antwort: dealNichtGefunden() };
  return { antwort: null, ctx, recordId };
}

export function geldFehlerAntwort(err: unknown): NextResponse {
  if (err instanceof GeldFehler) {
    return NextResponse.json({ error: { code: err.code, message: err.message } }, { status: err.status });
  }
  if ((err as { status?: number })?.status === 404) return notFound("Zahlung nicht gefunden.");
  throw err;
}

export async function jsonOderNull(req: NextRequest): Promise<Record<string, unknown> | null> {
  try {
    const b = await req.json();
    return b && typeof b === "object" && !Array.isArray(b) ? (b as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
