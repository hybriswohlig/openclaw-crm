/**
 * Gemeinsamer Vorlauf aller Einsatz-Routen (Plan 12): Anmeldung, nur Menschen
 * (jeder API-Schlüssel 403 `NUR_MENSCH`, auch lesend; kein MCP-Werkzeug) und
 * Fehlerantworten mit Code aus dem Vertrag.
 */
import { NextResponse, type NextRequest } from "next/server";
import { getAuthContext, unauthorized, type AuthContext } from "@/lib/api-utils";
import { EINSATZ_FEHLER_TEXT, type EinsatzFehlerCode, type TeamWunsch } from "@/lib/einsatz";

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

function minuten(x: unknown): number | null | undefined {
  if (x === null || x === undefined) return null;
  return typeof x === "number" ? x : undefined;
}

/** Body von `PUT …/einsatz` prüfen (Form, nicht Inhalt); null bei falscher Form. */
export function teamAusBody(body: unknown): { team: TeamWunsch[]; bestaetigtAmTag?: string[] } | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const b = body as Record<string, unknown>;
  if (!Array.isArray(b.team) || b.team.length > 30) return null;
  const team: TeamWunsch[] = [];
  for (const roh of b.team) {
    if (!roh || typeof roh !== "object") return null;
    const t = roh as Record<string, unknown>;
    const fahrt = minuten(t.plannedDriveMinutes);
    const arbeit = minuten(t.plannedWorkMinutes);
    if (typeof t.employeeId !== "string" || t.employeeId === "" || (t.role !== "lead" && t.role !== "helper")) return null;
    if (fahrt === undefined || arbeit === undefined) return null;
    team.push({ employeeId: t.employeeId, role: t.role, plannedDriveMinutes: fahrt, plannedWorkMinutes: arbeit });
  }
  let bestaetigtAmTag: string[] | undefined;
  if (b.bestaetigtAmTag !== undefined) {
    if (!Array.isArray(b.bestaetigtAmTag) || !b.bestaetigtAmTag.every((x) => typeof x === "string")) return null;
    bestaetigtAmTag = b.bestaetigtAmTag as string[];
  }
  return { team, ...(bestaetigtAmTag ? { bestaetigtAmTag } : {}) };
}

