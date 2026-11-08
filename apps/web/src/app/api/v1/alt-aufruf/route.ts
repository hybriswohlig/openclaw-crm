/**
 * Plan 14, Task W: Beacon der alten Oberfläche.
 *
 *   POST /api/v1/alt-aufruf   body: { pfad: string, mitAlt: boolean }
 *
 * Nur Sitzung (kein API-Schlüssel), Antwort 204 ohne Inhalt. `ui` kommt aus dem
 * Cookie `crm_ui` der Anfrage. Höchstens ein Eintrag je Nutzer, Pfad und Minute;
 * Pfade außerhalb der alten Oberfläche werden nicht geschrieben.
 */
import { NextRequest, NextResponse } from "next/server";
import { badRequest, forbidden, getAuthContext, unauthorized } from "@/lib/api-utils";
import { altAufrufMerken, altPfad, istAlterPfad, uiAusCookie, UI_COOKIE_NAME } from "@/services/alt-aufruf";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized(req);
  if (ctx.authMethod !== "cookie") return forbidden("Nur mit Sitzung");

  let roh: unknown;
  try {
    // sendBeacon schickt einen Blob; Text lesen und selbst parsen.
    roh = JSON.parse(await req.text());
  } catch {
    return badRequest("Invalid JSON body");
  }
  const body = (roh && typeof roh === "object" ? roh : {}) as { pfad?: unknown; mitAlt?: unknown };
  const pfad = altPfad(body.pfad);
  if (!pfad) return badRequest("pfad muss ein Pfad sein");
  // Nur bekannte alte Seiten zählen; alles andere still verwerfen.
  if (!istAlterPfad(pfad)) return new NextResponse(null, { status: 204 });

  await altAufrufMerken(ctx.workspaceId, ctx.userId, {
    pfad,
    mitAlt: body.mitAlt === true,
    ui: uiAusCookie(req.cookies.get(UI_COOKIE_NAME)?.value),
  });
  return new NextResponse(null, { status: 204 });
}
