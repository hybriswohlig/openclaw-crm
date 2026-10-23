import { NextRequest, NextResponse } from "next/server";
import { badRequest, forbidden, getAuthContext, isReadOnlyApiKey, notFound, success, unauthorized } from "@/lib/api-utils";
import type { LeadWahl } from "@/lib/phone-call-lead";
import { leadAusAnruf } from "@/services/phone-call-lead";

export const dynamic = "force-dynamic";

/** Legt aus einem noch offenen Anruf eine Person und einen Lead an. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ callId: string }> }) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized(req);
  if (isReadOnlyApiKey(ctx)) return forbidden("Nur-lesen-Schlüssel können keinen Lead anlegen.");

  const { callId } = await params;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest("JSON-Objekt erwartet");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) return badRequest("JSON-Objekt erwartet");
  const raw = body as Record<string, unknown>;
  if (raw.name != null && typeof raw.name !== "string") return badRequest("Name muss Text sein");
  if (raw.dealId != null && typeof raw.dealId !== "string") return badRequest("Lead muss eine Kennung sein");
  if (raw.neuerLead != null && typeof raw.neuerLead !== "boolean") return badRequest("Neuer Lead muss ja oder nein sein");

  const name = typeof raw.name === "string" ? raw.name : null;
  const dealId = typeof raw.dealId === "string" ? raw.dealId.trim() : "";
  const wahl: LeadWahl | null = dealId
    ? { art: "bestehend", dealId }
    : raw.neuerLead === true
      ? { art: "neu" }
      : null;

  try {
    const ergebnis = await leadAusAnruf({
      workspaceId: ctx.workspaceId,
      callId,
      name,
      wahl,
      actorId: ctx.userId,
    });
    if (ergebnis.art === "fehlt") return notFound("Anruf nicht gefunden");
    if (ergebnis.art === "name") {
      return badRequest("Bitte einen Namen eintragen, 2 bis 120 Zeichen, nicht nur Ziffern.");
    }
    if (ergebnis.art === "fehler") {
      return NextResponse.json({ error: { code: "INTERNAL", message: ergebnis.meldung } }, { status: 500 });
    }
    if (ergebnis.art === "konflikt") {
      return NextResponse.json(
        {
          error: { code: "CONFLICT", message: ergebnis.meldung },
          karten: ergebnis.karten,
          leads: ergebnis.leads,
        },
        { status: 409 }
      );
    }
    return success({
      dealRecordId: ergebnis.dealRecordId,
      personRecordId: ergebnis.personRecordId,
      matchStatus: ergebnis.matchStatus,
      bereitsDa: ergebnis.art === "fertig",
    });
  } catch (err) {
    console.error("[anruf-lead]", err instanceof Error ? err.message : "fehler");
    return NextResponse.json(
      { error: { code: "INTERNAL", message: "Der Lead konnte nicht angelegt werden." } },
      { status: 500 }
    );
  }
}
