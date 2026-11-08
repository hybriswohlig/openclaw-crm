import { NextRequest, NextResponse } from "next/server";
import {
  apiKeyScopeForbidden,
  badRequest,
  forbidden,
  getAuthContext,
  isReadOnlyApiKey,
  notFound,
  success,
  unauthorized,
} from "@/lib/api-utils";
import { dealImWorkspace } from "@/lib/kalkulation-versionen-antwort";
import {
  BewertungFehler,
  BewertungKonfigFehler,
  BewertungVersandFehler,
  bewertungAnfragen,
  bewertungVormerken,
  bewertungsVorschau,
} from "@/services/bewertung-anfragen";

type Params = { params: Promise<{ recordId: string }> };

/**
 * GET → `{ text, kanal, einwilligung, sperre, naechstesFenster, vormerkung }`:
 * Vorschau der Bewertungsanfrage, schreibt nichts.
 */
export async function GET(req: NextRequest, { params }: Params) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized(req);
  const { recordId } = await params;
  if (!(await dealImWorkspace(ctx.workspaceId, recordId))) return notFound("Deal nicht gefunden.");
  return success(await bewertungsVorschau(ctx.workspaceId, recordId));
}

/**
 * POST `{ text?, einwilligung?, vormerken? }` → `{ gesendet, gespraechId }`, mit
 * `vormerken: true` außerhalb der Sendezeit `{ vorgemerkt: true, faelligAb }`
 * (ohne Sperre wird auch dann sofort gesendet). Vormerken nur mit Sitzung
 * (der Treiber sendet später im Namen des Nutzers); offene Vormerkung → 409
 * `SCHON_VORGEMERKT`. Fehler einer
 * Hürde → 409 mit `code` und deutschem Text, `TEXT` → 400, fehlende
 * Konfiguration (NEXT_PUBLIC_APP_URL) → 500 `KONFIGURATION`, nichts gesendet.
 * Senden gescheitert → 502 `NICHT_GESENDET` (neuer Versuch möglich) oder
 * `VERSAND_UNKLAR` (Token bleibt, erst im Gespräch prüfen).
 */
export async function POST(req: NextRequest, { params }: Params) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized(req);
  if (isReadOnlyApiKey(ctx)) return apiKeyScopeForbidden("Nur-Lesen-Schlüssel darf keine Bewertung anfragen.");
  const { recordId } = await params;
  if (!(await dealImWorkspace(ctx.workspaceId, recordId))) return notFound("Deal nicht gefunden.");

  const roh = await req.text();
  let body: unknown = {};
  if (roh.trim()) {
    try {
      body = JSON.parse(roh);
    } catch {
      return badRequest("Ungültiges JSON.");
    }
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) return badRequest("Body muss ein Objekt sein.");
  const { text, einwilligung, vormerken } = body as { text?: unknown; einwilligung?: unknown; vormerken?: unknown };
  if (text !== undefined && typeof text !== "string") return badRequest("text muss ein Text sein.");
  if (einwilligung !== undefined && typeof einwilligung !== "string") return badRequest("einwilligung muss ein Text sein.");
  if (vormerken !== undefined && typeof vormerken !== "boolean") return badRequest("vormerken muss wahr oder falsch sein.");
  if (vormerken === true && ctx.authMethod !== "cookie") return forbidden("Vormerken geht nur in der Oberfläche.");

  const eingabe = {
    userId: ctx.userId,
    ...(text !== undefined ? { text } : {}),
    ...(einwilligung !== undefined ? { einwilligung } : {}),
  };
  try {
    if (vormerken === true) {
      const r = await bewertungVormerken(ctx.workspaceId, recordId, eingabe);
      return success("vorgemerkt" in r ? { vorgemerkt: true, faelligAb: r.faelligAb.toISOString() } : r);
    }
    return success(await bewertungAnfragen(ctx.workspaceId, recordId, eingabe));
  } catch (err) {
    if (err instanceof BewertungFehler) {
      return NextResponse.json(
        { error: { code: err.code, message: err.message } },
        { status: err.code === "TEXT" ? 400 : 409 }
      );
    }
    if (err instanceof BewertungVersandFehler) {
      return NextResponse.json({ error: { code: err.code, message: err.message } }, { status: 502 });
    }
    if (err instanceof BewertungKonfigFehler) {
      return NextResponse.json({ error: { code: "KONFIGURATION", message: err.message } }, { status: 500 });
    }
    throw err;
  }
}
