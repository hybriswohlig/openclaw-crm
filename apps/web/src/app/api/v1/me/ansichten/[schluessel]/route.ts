import { NextRequest } from "next/server";
import {
  badRequest,
  forbidden,
  getAuthContext,
  isReadOnlyApiKey,
  notFound,
  success,
  unauthorized,
} from "@/lib/api-utils";
import { DARSTELLUNG_COOKIE, cookieZeile } from "@/lib/dunkel-abschaltung";
import { DARSTELLUNG_SCHLUESSEL, darstellungPruefen } from "@/lib/einstellungen-uebersicht";
import { LEADS_ANSICHT_SCHLUESSEL, leadsAnsichtPruefen } from "@/lib/leads-board";
import { PLAN_ANSICHT_SCHLUESSEL, planAnsichtPruefen } from "@/lib/plan-heute";
import { setAnsicht } from "@/services/user-settings";

const ANSICHT_MAX_BYTES = 4 * 1024;

// Map statt Objekt: geerbte Eigenschaften wie „constructor“ oder „__proto__“ sind keine Ansichten.
const ANSICHT_PRUEFER = new Map<string, (roh: unknown) => unknown | null>([
  [LEADS_ANSICHT_SCHLUESSEL, leadsAnsichtPruefen],
  [PLAN_ANSICHT_SCHLUESSEL, planAnsichtPruefen],
  // Plan 13: Hell, Dunkel, Wie das Gerät. Wirksam seit Plan 14b (Spiegel-Cookie unten).
  [DARSTELLUNG_SCHLUESSEL, darstellungPruefen],
]);

/** Speichert eine geprüfte Ansicht unter ihrem Schlüssel. Andere Schlüssel bleiben. */
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ schluessel: string }> }
) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized(req);
  if (isReadOnlyApiKey(ctx)) return forbidden("Nur-Lesen-Schlüssel darf keine Ansicht speichern.");

  const { schluessel } = await params;
  const pruefen = ANSICHT_PRUEFER.get(schluessel);
  if (!pruefen) return notFound("Unbekannte Ansicht");

  const text = await req.text();
  if (Buffer.byteLength(text) > ANSICHT_MAX_BYTES) {
    return badRequest("Ansicht ist größer als 4 KB");
  }

  let roh: unknown;
  try {
    roh = JSON.parse(text);
  } catch {
    return badRequest("Ansicht ungültig");
  }

  const wert = pruefen(roh);
  if (!wert) return badRequest("Ansicht ungültig");

  await setAnsicht(ctx.userId, schluessel, wert);
  const res = success(wert);
  // Plan 14b: Spiegel-Cookie für das Kopf-Skript (nicht httpOnly, das Skript liest ihn).
  if (schluessel === DARSTELLUNG_SCHLUESSEL && typeof wert === "string") {
    res.headers.append("Set-Cookie", cookieZeile(DARSTELLUNG_COOKIE, wert, req.nextUrl.protocol === "https:"));
  }
  return res;
}
