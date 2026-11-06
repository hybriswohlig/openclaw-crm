import { NextRequest } from "next/server";
import { getAuthContext, unauthorized, success } from "@/lib/api-utils";
import {
  dealImWorkspace,
  dealNichtGefunden,
  ungueltigeVersion,
  versionAusPfad,
  versionsFehlerAntwort,
} from "@/lib/kalkulation-versionen-antwort";
import { ladeKalkulationsAnsicht } from "@/services/kalkulations-ansicht";

/**
 * GET → Ansichtsmodell der Kalkulationsseite zu dieser Version: `{ ansicht }`
 * (Typ `KalkulationsAnsicht` aus `lib/kalkulations-ansicht.ts`). Liest nur,
 * auch mit Nur-Lese-Schlüssel; unbekannte Version 404 NICHT_GEFUNDEN.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ recordId: string; version: string }> }) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized(req);
  const { recordId, version: segment } = await params;
  if (!(await dealImWorkspace(ctx.workspaceId, recordId))) return dealNichtGefunden();
  const version = versionAusPfad(segment);
  if (version === null) return ungueltigeVersion();

  try {
    const ansicht = await ladeKalkulationsAnsicht(ctx.workspaceId, recordId, version);
    return success({ ansicht });
  } catch (err) {
    const antwort = versionsFehlerAntwort(err);
    if (antwort) return antwort;
    throw err;
  }
}
