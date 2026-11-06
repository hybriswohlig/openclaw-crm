import { NextRequest, NextResponse } from "next/server";
import { badRequest, getAuthContext, isReadOnlyApiKey, success, unauthorized } from "@/lib/api-utils";
import { adresseGenau } from "@/lib/adresse-genau";
import {
  dealImWorkspace,
  dealNichtGefunden,
  ungueltigeVersion,
  versionAusPfad,
  versionsFehlerAntwort,
} from "@/lib/kalkulation-versionen-antwort";
import { VersionsFehler } from "@/services/kalkulation-versionen";
import { seiteAus, streetViewAdresse } from "@/services/street-view-adresse";
import { streetViewFuer } from "@/services/street-view-cache";

export const dynamic = "force-dynamic";

/**
 * GET `?seite=beladen|entladen[&v={version}]` → Street View der Adresse:
 * `{ status, bildUrl, panoLink, notiz, genau, adresse }`.
 * Ohne `v` die aktuelle Lead-Adresse, mit `v` die Adresse aus der Version.
 * `status`: "ok" | "kein_bild" | "fehler" | "nicht_geladen" | "ungenau" | "keine_adresse".
 * Ohne Google-Schlüssel (und ohne gültigen gespeicherten Stand) 503
 * „Street View ist nicht eingerichtet.“. Nur-Lesen-Schlüssel: kein Abruf.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ recordId: string }> }) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized(req);
  const { recordId } = await params;
  if (!(await dealImWorkspace(ctx.workspaceId, recordId))) return dealNichtGefunden();

  const sp = req.nextUrl.searchParams;
  const seite = seiteAus(sp.get("seite"));
  if (!seite) return badRequest("seite muss beladen oder entladen sein.");
  const vText = sp.get("v");
  const version = vText === null ? null : versionAusPfad(vText);
  if (vText !== null && version === null) return ungueltigeVersion();

  const roh = await streetViewAdresse(ctx.workspaceId, recordId, seite, version);
  if (roh === undefined) {
    return versionsFehlerAntwort(new VersionsFehler("NICHT_GEFUNDEN", `Version v${version} nicht gefunden.`))!;
  }
  const a = adresseGenau(roh);
  const leer = { bildUrl: null, panoLink: null, notiz: null, genau: false };
  if (!a.text) return success({ status: "keine_adresse" as const, ...leer, adresse: null });
  if (!a.genau) return success({ status: "ungenau" as const, ...leer, adresse: a.text });

  const r = await streetViewFuer(ctx.workspaceId, a.text, { darfAbrufen: !isReadOnlyApiKey(ctx) });
  if (r.status === "ohne_schluessel") {
    return NextResponse.json(
      { error: { code: "NICHT_EINGERICHTET", message: "Street View ist nicht eingerichtet." } },
      { status: 503 }
    );
  }
  const bildUrl =
    r.status === "ok"
      ? `/api/v1/deals/${encodeURIComponent(recordId)}/street-view/bild?seite=${seite}&k=${r.schluessel}`
      : null;
  return success({ status: r.status, bildUrl, panoLink: r.panoLink, notiz: r.notiz, genau: true, adresse: a.text });
}
