import { NextRequest } from "next/server";
import { badRequest, getAuthContext, requireAdmin, success, unauthorized } from "@/lib/api-utils";
import type { RueckfrageStatus } from "@/db/schema/intern";
import { erstelleRueckfragen, listeRueckfragen, RueckfrageFehler } from "@/services/intern/rueckfragen";
import { validiereRueckfragen } from "@/services/intern/rueckfragen-befehle";

/**
 * Rückfragen per WhatsApp an eine interne Nummer, für Werkzeuge außerhalb des
 * CRM (Kassensturz auf Darios Mac, Schlüssel "kassensturz" mit Vollzugriff).
 *
 *   POST /api/v1/intern/rueckfragen
 *     { quelle, empfaenger?, fragen: [{ frage, optionen, payload?, ablaufTage? }] }
 *     201 { data: { codes, zugestellt } }; eine Nachricht mit allen Fragen geht an
 *     den Empfänger (Vorgabe: Einstellung intern_rueckfragen_empfaenger, sonst die
 *     erste interne Nummer); ist das Konto nicht verbunden, holt das CRM nach.
 *   GET /api/v1/intern/rueckfragen?quelle=kassensturz&status=beantwortet&seit=ISO
 *     200 { data: { rueckfragen: [...] } }, höchstens 200, aufsteigend.
 *
 * Nur Admins: die Antworten enthalten Namen von Bewirtungsgästen.
 */

const QUELLE_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;
const STATUS: readonly RueckfrageStatus[] = ["offen", "beantwortet", "abgelaufen"];

export async function POST(req: NextRequest) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized(req);
  const verboten = requireAdmin(ctx);
  if (verboten) return verboten;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest("Body ist kein JSON");
  }
  const geprueft = validiereRueckfragen(body);
  if (!geprueft.ok) return badRequest(geprueft.fehler);
  try {
    return success(await erstelleRueckfragen(ctx.workspaceId, geprueft.value), 201);
  } catch (error) {
    if (error instanceof RueckfrageFehler) return badRequest(error.message);
    throw error;
  }
}

export async function GET(req: NextRequest) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized(req);
  const verboten = requireAdmin(ctx);
  if (verboten) return verboten;
  const params = req.nextUrl.searchParams;
  const quelle = params.get("quelle") ?? "";
  if (!QUELLE_RE.test(quelle)) return badRequest("quelle fehlt oder ist ungültig");
  const status = (params.get("status") ?? "beantwortet") as RueckfrageStatus;
  if (!STATUS.includes(status)) return badRequest("status muss offen, beantwortet oder abgelaufen sein");
  const seitRoh = params.get("seit");
  const seit = seitRoh ? new Date(seitRoh) : null;
  if (seit && Number.isNaN(seit.getTime())) return badRequest("seit muss ein ISO-Zeitpunkt sein");
  const rueckfragen = await listeRueckfragen(ctx.workspaceId, seit ? { quelle, status, seit } : { quelle, status });
  return success({ rueckfragen });
}
