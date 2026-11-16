/**
 * Crew-Link per WhatsApp schicken (Absender: Rümpeltürken). Nur Menschen: jeder
 * API-Schlüssel 403 `NUR_MENSCH`, wie die übrigen Crew-Link-Routen.
 *
 * POST → `{ data: { an, link } }`; legt den Link bei Bedarf an.
 */
import { NextResponse, type NextRequest } from "next/server";
import { success } from "@/lib/api-utils";
import { einsatzAutor, einsatzVorlauf } from "@/lib/einsatz-route";
import { crewLinkSenden } from "@/services/crew/link-senden";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

type Params = { params: Promise<{ employeeId: string }> };

const FEHLER: Record<string, { status: number; message: string }> = {
  NICHT_GEFUNDEN: { status: 404, message: "Person nicht gefunden." },
  INAKTIV: { status: 409, message: "Deaktivierte Personen bekommen keinen Crew-Link." },
  KEIN_TELEFON: { status: 409, message: "Erst eine Telefonnummer eintragen und speichern." },
  GESPERRT: { status: 409, message: "Der Link ist gesperrt. Erst wieder freigeben, dann senden." },
  KEIN_ABSENDER: { status: 503, message: "Das WhatsApp von Rümpeltürken ist gerade nicht verbunden." },
};

export async function POST(req: NextRequest, { params }: Params) {
  const v = await einsatzVorlauf(req);
  if (v.antwort) return v.antwort;
  const { employeeId } = await params;
  const r = await crewLinkSenden(v.ctx.workspaceId, employeeId, einsatzAutor(v.ctx));
  if (r.ok) return success({ an: r.an, link: r.link });
  if (r.code === "VERSAND") {
    return NextResponse.json({ error: { code: "VERSAND", message: `WhatsApp hat nicht geklappt: ${r.message}` } }, { status: 502 });
  }
  const f = FEHLER[r.code];
  return NextResponse.json({ error: { code: r.code, message: f.message } }, { status: f.status });
}
