import { NextRequest, NextResponse } from "next/server";
import {
  apiKeyScopeForbidden,
  badRequest,
  getAuthContext,
  isReadOnlyApiKey,
  success,
  unauthorized,
} from "@/lib/api-utils";
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
import { notizAus } from "@/services/street-view-cache";
import { dbStreetViewSpeicher } from "@/services/street-view-speicher";

const NOTIZ_MAX = 500;

/**
 * PUT `{ seite, text, v? }` → Notiz zur Street-View-Adresse (bis 500 Zeichen,
 * leerer Text löscht sie): `{ notiz: { text, von, am } | null }`.
 * Die Notiz hängt an der Adresse (je Workspace), nicht an der Version.
 */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ recordId: string }> }) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized(req);
  if (isReadOnlyApiKey(ctx)) return apiKeyScopeForbidden("Nur-Lesen-Schlüssel darf keine Notiz schreiben.");
  const { recordId } = await params;
  if (!(await dealImWorkspace(ctx.workspaceId, recordId))) return dealNichtGefunden();

  const body: unknown = await req.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) return badRequest("Body muss ein JSON-Objekt sein.");
  const b = body as Record<string, unknown>;
  const seite = seiteAus(b.seite);
  if (!seite) return badRequest("seite muss beladen oder entladen sein.");
  if (typeof b.text !== "string") return badRequest("text muss ein Text sein.");
  const text = b.text.trim();
  if (text.length > NOTIZ_MAX) return badRequest(`Die Notiz darf höchstens ${NOTIZ_MAX} Zeichen haben.`);
  let version: number | null = null;
  if (b.v !== undefined && b.v !== null) {
    version = versionAusPfad(String(b.v));
    if (version === null) return ungueltigeVersion();
  }

  const roh = await streetViewAdresse(ctx.workspaceId, recordId, seite, version);
  if (roh === undefined) {
    return versionsFehlerAntwort(new VersionsFehler("NICHT_GEFUNDEN", `Version v${version} nicht gefunden.`))!;
  }
  const a = adresseGenau(roh);
  if (!a.genau || !a.schluessel) return badRequest("Adresse ungenau, kein Street View.");

  const speicher = await dbStreetViewSpeicher();
  const gesetzt = await speicher.notizSetzen(ctx.workspaceId, a.schluessel, text === "" ? null : text, ctx.userId);
  if (!gesetzt) {
    return NextResponse.json(
      { error: { code: "NOT_FOUND", message: "Für diese Adresse gibt es noch kein Street View." } },
      { status: 404 }
    );
  }
  return success({ notiz: notizAus(await speicher.lesen(ctx.workspaceId, a.schluessel)) });
}
