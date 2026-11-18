/**
 * Crew-API v1 `GET /jobs/:dealId/briefing/streetview/:stop` (`from` | `to`) →
 * Street-View-Bild (JPEG) der Adresse, nur für das eingeteilte Team bei
 * freigegebenem Briefing. Kein Bild bei Google → 404 JOB_NICHT_SICHTBAR, das
 * Portal blendet den Platz dann aus. Bilder bleiben eine Weile im Speicher,
 * damit nicht jeder Aufruf bei Google bezahlt wird.
 */
import { NextResponse, type NextRequest } from "next/server";
import { crewFehler, KEIN_CACHE } from "@/lib/crew/antwort";
import { requireCrew } from "@/services/crew/auth";
import { briefingStoppAdresse } from "@/services/crew/briefing";
import { fetchStreetView, StreetViewConfigError } from "@/services/street-view";

export const dynamic = "force-dynamic";

const DEAL_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const MAX = 60;
const DAUER_MS = 24 * 60 * 60 * 1000;
const g = globalThis as typeof globalThis & { __crewStreetView?: Map<string, { bytes: Buffer | null; mime: string; bis: number }> };
const speicher = (g.__crewStreetView ??= new Map());

export async function GET(req: NextRequest, { params }: { params: Promise<{ dealId: string; stop: string }> }) {
  const a = await requireCrew(req);
  if (!a.ok) return a.antwort;
  const { dealId, stop } = await params;
  if (!DEAL_ID_RE.test(dealId) || (stop !== "from" && stop !== "to")) return crewFehler("JOB_NICHT_SICHTBAR");
  const adresse = await briefingStoppAdresse(a.k, dealId, stop);
  if (!adresse) return crewFehler("JOB_NICHT_SICHTBAR");

  const jetzt = Date.now();
  let e = speicher.get(adresse);
  if (!e || e.bis < jetzt) {
    try {
      const r = await fetchStreetView({ address: adresse, width: 640, height: 400, fov: 80 });
      e = { bytes: r ? r.bytes : null, mime: r?.mime ?? "image/jpeg", bis: jetzt + DAUER_MS };
    } catch (err) {
      if (!(err instanceof StreetViewConfigError)) console.error("[crew-streetview]", err instanceof Error ? err.message : String(err));
      return crewFehler("JOB_NICHT_SICHTBAR");
    }
    speicher.set(adresse, e);
    if (speicher.size > MAX) speicher.delete(speicher.keys().next().value!);
  }
  if (!e.bytes) return crewFehler("JOB_NICHT_SICHTBAR");
  return new NextResponse(new Uint8Array(e.bytes), {
    status: 200,
    headers: { ...KEIN_CACHE, "Content-Type": e.mime.startsWith("image/") ? e.mime : "image/jpeg", "Content-Length": String(e.bytes.byteLength) },
  });
}
