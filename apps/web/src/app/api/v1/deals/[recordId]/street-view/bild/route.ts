import { NextRequest, NextResponse } from "next/server";
import { get } from "@vercel/blob";
import { badRequest, getAuthContext, unauthorized } from "@/lib/api-utils";
import { dealImWorkspace, dealNichtGefunden } from "@/lib/kalkulation-versionen-antwort";
import { seiteAus } from "@/services/street-view-adresse";
import { streetViewBildPfad } from "@/services/street-view-cache";

export const dynamic = "force-dynamic";

function nichtGefunden() {
  return NextResponse.json({ error: { code: "NOT_FOUND", message: "Kein Street-View-Bild." } }, { status: 404 });
}

/**
 * GET `?seite=…&k={schluessel}` → das gespeicherte Street-View-Bild (privat
 * im Blob) als Stream. Nur gültige Bilder (höchstens 30 Tage) des eigenen
 * Workspace; ruft Google nie auf.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ recordId: string }> }) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized(req);
  const { recordId } = await params;
  if (!(await dealImWorkspace(ctx.workspaceId, recordId))) return dealNichtGefunden();

  const sp = req.nextUrl.searchParams;
  if (!seiteAus(sp.get("seite"))) return badRequest("seite muss beladen oder entladen sein.");
  const k = sp.get("k") ?? "";
  const pfad = await streetViewBildPfad(ctx.workspaceId, k);
  if (!pfad) return nichtGefunden();

  const blob = await get(pfad, { access: "private" }).catch(() => null);
  if (!blob || blob.statusCode !== 200 || !blob.stream) return nichtGefunden();
  return new NextResponse(blob.stream, {
    status: 200,
    headers: {
      "Content-Type": blob.blob?.contentType || "image/jpeg",
      "Cache-Control": "private, max-age=86400",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
