import { NextRequest, NextResponse } from "next/server";
import { kvRoute, type KvStandParams } from "@/lib/kv-editor-route";
import { standPdf } from "@/services/kv-editor";
import { KvEditorFehlerKlasse } from "@/services/kv-editor-fehler";

export const dynamic = "force-dynamic";

/** GET → PDF des Stands, inline und nie zwischengespeichert; ohne PDF (druckt, Fehler) 404. */
export async function GET(req: NextRequest, { params }: KvStandParams) {
  return kvRoute(req, params, async (ctx, deal) => {
    const { standId } = await params;
    const pdf = await standPdf(ctx.workspaceId, deal, standId);
    if (!pdf) throw new KvEditorFehlerKlasse("KEIN_KV", "Für diesen Stand gibt es noch kein PDF.");
    return new NextResponse(new Uint8Array(pdf.bytes), {
      status: 200,
      headers: {
        "Content-Type": pdf.mimeType,
        "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(pdf.fileName)}`,
        "Cache-Control": "private, no-store",
      },
    });
  });
}
