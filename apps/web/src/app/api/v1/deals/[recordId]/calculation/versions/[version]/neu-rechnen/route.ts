import { NextRequest } from "next/server";
import { forbidden, getAuthContext, isReadOnlyApiKey, unauthorized, success } from "@/lib/api-utils";
import {
  autorAus,
  dealImWorkspace,
  dealNichtGefunden,
  ungueltigeVersion,
  versionAusPfad,
  versionsFehlerAntwort,
} from "@/lib/kalkulation-versionen-antwort";
import { entwurfNeuRechnen } from "@/services/kalkulation-versionen";

/**
 * POST → rechnet den Entwurf neu, wenn er veraltet ist oder einen Fehler hat:
 * `{ version, gerechnet }` (`gerechnet: false` = war aktuell, nichts geändert).
 * Gesperrte Version 400 UNGUELTIG. Nicht für Nur-Lese-Schlüssel.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ recordId: string; version: string }> }) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized(req);
  if (isReadOnlyApiKey(ctx)) return forbidden("Nur-Lese-Schlüssel darf nicht neu rechnen.");
  const { recordId, version: segment } = await params;
  if (!(await dealImWorkspace(ctx.workspaceId, recordId))) return dealNichtGefunden();
  const version = versionAusPfad(segment);
  if (version === null) return ungueltigeVersion();

  try {
    const r = await entwurfNeuRechnen(ctx.workspaceId, recordId, version, autorAus(ctx));
    return success({ version: r.version, gerechnet: r.gerechnet });
  } catch (err) {
    const antwort = versionsFehlerAntwort(err);
    if (antwort) return antwort;
    throw err;
  }
}
