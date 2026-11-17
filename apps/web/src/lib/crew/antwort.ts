/**
 * Antworten der Crew-API: immer `{ error: CODE, message? }` (Vertrag), nie
 * gecacht, nie mit CORS (nur Server zu Server).
 */
import { NextResponse } from "next/server";
import type { CrewError } from "./contract";

export type CrewFehlerCode = CrewError["error"];

const STATUS: Record<CrewFehlerCode, number> = {
  UNAUTHORIZED: 401,
  LINK_UNGUELTIG: 404,
  JOB_NICHT_SICHTBAR: 404,
  BEREITS_BESTAETIGT: 409,
  UNGUELTIG: 400,
  BRIEFING_NICHT_FREI: 404,
};

export const KEIN_CACHE = { "Cache-Control": "no-store" } as const;

export function crewFehler(code: CrewFehlerCode, message?: string): NextResponse {
  return NextResponse.json(message ? { error: code, message } : { error: code }, { status: STATUS[code], headers: KEIN_CACHE });
}

export function crewOk<T>(daten: T, status = 200): NextResponse {
  return NextResponse.json(daten, { status, headers: KEIN_CACHE });
}

/** JSON-Körper lesen; kaputt oder leer → null. */
export async function crewJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    return null;
  }
}
