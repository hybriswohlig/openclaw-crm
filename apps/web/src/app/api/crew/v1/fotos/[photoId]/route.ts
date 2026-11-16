/**
 * Crew-API v1 `GET /fotos/:photoId`: Bytes eines für die Crew freigegebenen
 * Fotos, nur wenn sein Job für diesen Link sichtbar ist. Immer neu kodiert
 * (WebP, max. 1000 px, ohne EXIF/GPS; services/crew/bild.ts).
 */
import { NextResponse, type NextRequest } from "next/server";
import { crewFehler } from "@/lib/crew/antwort";
import { requireCrew } from "@/services/crew/auth";
import { crewFotoLaden } from "@/services/crew/fotos";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: Promise<{ photoId: string }> }) {
  const a = await requireCrew(req);
  if (!a.ok) return a.antwort;
  const { photoId } = await params;
  const f = await crewFotoLaden(a.k, photoId);
  if (!f.ok) return crewFehler("JOB_NICHT_SICHTBAR");
  return new NextResponse(f.body as BodyInit, {
    headers: {
      "Content-Type": f.contentType,
      "Cache-Control": "private, max-age=3600",
      "Content-Disposition": "inline",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
