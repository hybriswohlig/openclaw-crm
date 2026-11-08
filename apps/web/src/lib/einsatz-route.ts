/**
 * Gemeinsamer Vorlauf aller Einsatz-Routen (Plan 12): Anmeldung, nur Menschen
 * (jeder API-Schlüssel 403 `NUR_MENSCH`, auch lesend; kein MCP-Werkzeug) und
 * Fehlerantworten mit Code aus dem Vertrag.
 */
import { NextResponse, type NextRequest } from "next/server";
import { getAuthContext, unauthorized, type AuthContext } from "@/lib/api-utils";
import { EINSATZ_FEHLER_TEXT, type EinsatzFehlerCode } from "@/lib/einsatz";

export type EinsatzVorlauf = { antwort: NextResponse; ctx?: undefined } | { antwort: null; ctx: AuthContext };

export async function einsatzVorlauf(req: NextRequest): Promise<EinsatzVorlauf> {
  const ctx = await getAuthContext(req);
  if (!ctx) return { antwort: unauthorized(req) };
  if (ctx.authMethod === "api_key") return { antwort: einsatzFehler("NUR_MENSCH", 403) };
  return { antwort: null, ctx };
}

/** `{ error: { code, message, ...extra } }` mit dem Text aus `EINSATZ_FEHLER_TEXT`. */
export function einsatzFehler(code: EinsatzFehlerCode, status: number, extra?: Record<string, unknown>): NextResponse {
  return NextResponse.json({ error: { code, message: EINSATZ_FEHLER_TEXT[code], ...extra } }, { status });
}

/** Autor für `created_by`/`confirmed_by`: die Nutzer-ID der Sitzung. */
export function einsatzAutor(ctx: AuthContext): string {
  return ctx.userId;
}
