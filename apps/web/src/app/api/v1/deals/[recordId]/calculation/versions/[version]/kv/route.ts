import { NextRequest, NextResponse } from "next/server";
import { badRequest, getAuthContext, success, unauthorized } from "@/lib/api-utils";
import { parseDocumentCopy } from "@/lib/commercial-document-request";
import {
  dealImWorkspace,
  dealNichtGefunden,
  ungueltigeVersion,
  versionAusPfad,
  versionsFehlerAntwort,
} from "@/lib/kalkulation-versionen-antwort";
import { CommercialDocumentError } from "@/services/commercial-documents";
import { kvAusVersion } from "@/services/kv-aus-version";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * POST { copy?: { intro?, closing?, remarks? } } → KV aus der gesperrten Version.
 * Nicht-Kottke: `{ renderer: "crm", document, fileName }` (PDF gespeichert, mit der
 * Version verknüpft, nichts an den Kunden). Kottke: `{ renderer: "vps", hinweis }`,
 * das PDF entsteht über „Dokument erzeugen“. Sätze mit Beträgen fallen aus den
 * Texten. Nicht gesperrt oder Angebot von Hand geändert: 400 UNGUELTIG.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ recordId: string; version: string }> }) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized(req);
  const { recordId, version: segment } = await params;
  if (!(await dealImWorkspace(ctx.workspaceId, recordId))) return dealNichtGefunden();
  const version = versionAusPfad(segment);
  if (version === null) return ungueltigeVersion();

  const body = (await req.json().catch(() => ({}))) as { copy?: unknown } | null;
  let copy;
  try {
    copy = parseDocumentCopy(body?.copy, "KV");
  } catch (err) {
    return badRequest(err instanceof Error ? err.message : "copy ungültig");
  }

  try {
    const r = await kvAusVersion({
      workspaceId: ctx.workspaceId,
      dealRecordId: recordId,
      version,
      copy,
      updatedBy: ctx.userId,
    });
    return success(r);
  } catch (err) {
    const antwort = versionsFehlerAntwort(err);
    if (antwort) return antwort;
    if (err instanceof CommercialDocumentError) {
      return NextResponse.json({ error: { code: err.code, message: err.message } }, { status: err.status });
    }
    console.error("[calculation/versions/kv]", err);
    return NextResponse.json(
      { error: { code: "RENDER_FAILED", message: "Dokument konnte nicht erzeugt werden." } },
      { status: 500 }
    );
  }
}
