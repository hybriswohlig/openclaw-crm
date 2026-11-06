import { NextRequest } from "next/server";
import { getAuthContext, unauthorized, success } from "@/lib/api-utils";
import {
  dealImWorkspace,
  dealNichtGefunden,
  ungueltigeVersion,
  versionAusPfad,
  versionsFehlerAntwort,
} from "@/lib/kalkulation-versionen-antwort";
import { VersionsFehler } from "@/services/kalkulation-versionen";
import { dbVersionsSpeicher } from "@/services/kalkulation-versionen-speicher";

/**
 * GET → eine Version mit allen Feldern (samt Anfrage und Ergebnis des Rechners):
 * `{ version }`. Liest nur Gespeichertes, auch mit Nur-Lese-Schlüssel.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ recordId: string; version: string }> }) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized(req);
  const { recordId, version: segment } = await params;
  if (!(await dealImWorkspace(ctx.workspaceId, recordId))) return dealNichtGefunden();
  const version = versionAusPfad(segment);
  if (version === null) return ungueltigeVersion();

  const zeile = await dbVersionsSpeicher.lesen(ctx.workspaceId, recordId, version);
  if (!zeile) return versionsFehlerAntwort(new VersionsFehler("NICHT_GEFUNDEN", `Version v${version} nicht gefunden.`))!;
  return success({ version: zeile });
}
