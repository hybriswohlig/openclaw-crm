import { NextRequest } from "next/server";
import { getAuthContext, unauthorized, badRequest, success } from "@/lib/api-utils";
import { pruefeUebersteuerung } from "@/lib/kalkulation-versionen";
import {
  autorAus,
  dealImWorkspace,
  dealNichtGefunden,
  ungueltigeVersion,
  versionAusPfad,
  versionsFehlerAntwort,
} from "@/lib/kalkulation-versionen-antwort";
import { uebersteuern } from "@/services/kalkulation-versionen";

/**
 * POST { art, key, wert, grund, fotoRef? } → begründete Übersteuerung: `{ version, neu }`.
 * An einer gesperrten Version landet sie im Entwurf (`neu`: der Entwurf wurde dafür
 * angelegt). Der Autor kommt aus dem Auth-Kontext, ein Autor im Body zählt nicht.
 * Ungültige Übersteuerungen (etwa ohne Grund) → 400 vor jeder Nebenwirkung.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ recordId: string; version: string }> }) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized(req);
  const { recordId, version: segment } = await params;
  if (!(await dealImWorkspace(ctx.workspaceId, recordId))) return dealNichtGefunden();
  const version = versionAusPfad(segment);
  if (version === null) return ungueltigeVersion();

  const body: unknown = await req.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) return badRequest("Body muss ein JSON-Objekt sein.");
  const b = body as Record<string, unknown>;
  if (b.fotoRef !== undefined && b.fotoRef !== null && typeof b.fotoRef !== "string") {
    return badRequest("fotoRef muss ein Text sein.");
  }
  const eingabe = {
    art: typeof b.art === "string" ? b.art : "",
    key: typeof b.key === "string" ? b.key : "",
    wert: b.wert,
    grund: typeof b.grund === "string" ? b.grund : "",
    ...(typeof b.fotoRef === "string" ? { fotoRef: b.fotoRef } : {}),
  };

  try {
    // Früh prüfen (Grund, Art, Wert), damit nichts angelegt oder gemeldet wird; der Dienst prüft erneut.
    pruefeUebersteuerung(eingabe);
    const r = await uebersteuern(ctx.workspaceId, recordId, version, eingabe, autorAus(ctx));
    return success({ version: r.version, neu: r.neu });
  } catch (err) {
    const antwort = versionsFehlerAntwort(err);
    if (antwort) return antwort;
    throw err;
  }
}
