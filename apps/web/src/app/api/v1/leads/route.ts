import { NextRequest, NextResponse } from "next/server";
import { badRequest, forbidden, getAuthContext, isReadOnlyApiKey, unauthorized } from "@/lib/api-utils";
import { SOURCE_CHANNEL_OPTIONS } from "@/lib/deal-source";
import { NEUER_LEAD_TEXT, neuerLeadPruefen } from "@/lib/handy-links";
import { neuenLeadAnlegen } from "@/services/lead-anlegen";

export const dynamic = "force-dynamic";

/** Legt einen Lead von Hand an („Neuer Lead“). */
export async function POST(req: NextRequest) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized(req);
  if (isReadOnlyApiKey(ctx)) return forbidden("Nur-lesen-Schlüssel können keinen Lead anlegen.");
  // Mensch entscheidet (Plan 10): Die Wahl unter Treffern trifft nie ein Bot.
  if (ctx.authMethod !== "cookie") return forbidden("Einen Lead von Hand legt nur ein Mensch in der Oberfläche an.");

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest("JSON-Objekt erwartet");
  }

  const pruefung = neuerLeadPruefen(body, SOURCE_CHANNEL_OPTIONS);
  if (!pruefung.ok) {
    return NextResponse.json(
      { error: { code: "UNGUELTIG", feld: pruefung.feld, message: pruefung.text } },
      { status: 400 }
    );
  }

  try {
    const ergebnis = await neuenLeadAnlegen(ctx.workspaceId, pruefung.eingabe, ctx.userId);
    if (!ergebnis.ok && ergebnis.code === "FIRMA") {
      return NextResponse.json(
        { error: { code: "UNGUELTIG", feld: "firma", message: NEUER_LEAD_TEXT.firma } },
        { status: 400 }
      );
    }
    if (!ergebnis.ok && ergebnis.code === "RUECKFRAGE") {
      return NextResponse.json(
        {
          error: { code: "RUECKFRAGE", message: "Zu dieser Nummer gibt es schon Kunden." },
          treffer: ergebnis.treffer,
        },
        { status: 409 }
      );
    }
    if (!ergebnis.ok) {
      // Fehlende Einrichtung (Objekte, Felder, Stufe „Neue Anfrage“), kein Serverfehler.
      return NextResponse.json({ error: { code: "EINRICHTUNG", message: ergebnis.meldung } }, { status: 409 });
    }
    return NextResponse.json(
      { data: { ok: true, dealRecordId: ergebnis.dealRecordId, personRecordId: ergebnis.personRecordId } },
      { status: 201 }
    );
  } catch (err) {
    console.error("[neuer-lead]", err instanceof Error ? err.message : "fehler");
    return NextResponse.json(
      { error: { code: "INTERNAL", message: "Der Lead konnte nicht angelegt werden." } },
      { status: 500 }
    );
  }
}
