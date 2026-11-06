import { NextRequest } from "next/server";
import { getAuthContext, isReadOnlyApiKey, success, unauthorized } from "@/lib/api-utils";
import {
  dealImWorkspace,
  dealNichtGefunden,
  ungueltigeVersion,
  versionAusPfad,
  versionsFehlerAntwort,
} from "@/lib/kalkulation-versionen-antwort";
import { VersionsFehler } from "@/services/kalkulation-versionen";
import { dbVersionsSpeicher } from "@/services/kalkulation-versionen-speicher";
import { routeFuer } from "@/services/kalkulations-route";

export const dynamic = "force-dynamic";

/**
 * GET → Route der Version (Station → Beladen → Entladen → Station):
 * `{ status, teilstrecken, googleLink, stationen, gesamtKm, gesamtMinuten }`.
 * Jeder Status kommt mit 200 (auch "ohne_schluessel" und "nicht_freigegeben");
 * Hinweistexte in `lib/route-hinweise.ts`. Nur-Lesen-Schlüssel: kein Google-Abruf.
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
  return success(await routeFuer(ctx.workspaceId, zeile, { darfAbrufen: !isReadOnlyApiKey(ctx) }));
}
