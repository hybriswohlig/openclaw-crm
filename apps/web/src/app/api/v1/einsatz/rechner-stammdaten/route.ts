/**
 * Stationen und Fahrzeugklassen des Rechners für den Buchungsdialog.
 * Nicht erreichbar → 502 `RECHNER`.
 */
import { NextResponse, type NextRequest } from "next/server";
import { success } from "@/lib/api-utils";
import { einsatzVorlauf } from "@/lib/einsatz-route";
import { RechnerStammdatenFehler, rechnerKlassen, rechnerStationen } from "@/services/rechner/stammdaten";

export async function GET(req: NextRequest) {
  const vor = await einsatzVorlauf(req);
  if (vor.antwort) return vor.antwort;
  try {
    const [stationen, klassen] = await Promise.all([rechnerStationen(), rechnerKlassen()]);
    return success({ stationen, klassen });
  } catch (e) {
    if (e instanceof RechnerStammdatenFehler) {
      return NextResponse.json({ error: { code: "RECHNER", message: e.message } }, { status: 502 });
    }
    throw e;
  }
}
