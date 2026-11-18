/**
 * Crew-API v1 `GET /jobs/:dealId/briefing/streetview/:stop` (`from` | `to`) →
 * Street-View-Bild (JPEG) der Adresse, nur für das eingeteilte Team bei
 * freigegebenem Briefing. Kein Bild bei Google → 404 JOB_NICHT_SICHTBAR, das
 * Portal blendet den Platz dann aus.
 *
 * Kosten: Bilder (und „kein Bild“) bleiben einen Tag im Speicher, Fehler zehn
 * Minuten; gleichzeitige Abrufe derselben Adresse gehen nur einmal zu Google;
 * je Person höchstens 40 Abrufe bei Google pro Stunde. Der Speicher gilt je
 * Server-Instanz; das Portal lässt den Browser das Bild zusätzlich einen Tag behalten.
 */
import { NextResponse, type NextRequest } from "next/server";
import { crewFehler, KEIN_CACHE } from "@/lib/crew/antwort";
import { requireCrew } from "@/services/crew/auth";
import { briefingStoppAdresse } from "@/services/crew/briefing";
import { fetchStreetView, StreetViewConfigError } from "@/services/street-view";

export const dynamic = "force-dynamic";

const DEAL_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const MAX = 60;
const TAG_MS = 24 * 60 * 60 * 1000;
const FEHLER_MS = 10 * 60 * 1000;
const STUNDE_MS = 60 * 60 * 1000;
const JE_PERSON = 40;

type Eintrag = { bytes: Buffer | null; mime: string; bis: number };
const g = globalThis as typeof globalThis & {
  __crewStreetView?: { speicher: Map<string, Eintrag>; laufend: Map<string, Promise<Eintrag>>; zaehler: Map<string, number[]> };
};
const zustand = (g.__crewStreetView ??= { speicher: new Map(), laufend: new Map(), zaehler: new Map() });

/** true, wenn diese Person noch zu Google darf (gleitendes Stundenfenster). */
function kontingent(person: string, jetzt: number): boolean {
  const liste = (zustand.zaehler.get(person) ?? []).filter((t: number) => t > jetzt - STUNDE_MS);
  if (liste.length >= JE_PERSON) {
    zustand.zaehler.set(person, liste);
    return false;
  }
  liste.push(jetzt);
  zustand.zaehler.set(person, liste);
  return true;
}

async function holen(adresse: string): Promise<Eintrag> {
  const jetzt = Date.now();
  try {
    const r = await fetchStreetView({ address: adresse, width: 640, height: 400, fov: 80 });
    return { bytes: r ? r.bytes : null, mime: r?.mime ?? "image/jpeg", bis: jetzt + TAG_MS };
  } catch (err) {
    if (!(err instanceof StreetViewConfigError)) console.error("[crew-streetview]", err instanceof Error ? err.message : String(err));
    return { bytes: null, mime: "image/jpeg", bis: jetzt + FEHLER_MS };
  }
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ dealId: string; stop: string }> }) {
  const a = await requireCrew(req);
  if (!a.ok) return a.antwort;
  const { dealId, stop } = await params;
  if (!DEAL_ID_RE.test(dealId) || (stop !== "from" && stop !== "to")) return crewFehler("JOB_NICHT_SICHTBAR");
  const adresse = await briefingStoppAdresse(a.k, dealId, stop);
  if (!adresse) return crewFehler("JOB_NICHT_SICHTBAR");

  const jetzt = Date.now();
  let e = zustand.speicher.get(adresse);
  if (!e || e.bis < jetzt) {
    let p = zustand.laufend.get(adresse);
    if (!p) {
      if (!kontingent(a.k.employee.id, jetzt)) return crewFehler("JOB_NICHT_SICHTBAR");
      p = holen(adresse).finally(() => zustand.laufend.delete(adresse));
      zustand.laufend.set(adresse, p);
    }
    e = await p;
    zustand.speicher.set(adresse, e);
    if (zustand.speicher.size > MAX) zustand.speicher.delete(zustand.speicher.keys().next().value!);
  }
  if (!e.bytes) return crewFehler("JOB_NICHT_SICHTBAR");

  // Während des Abrufs könnte das Briefing zurückgezogen oder die Person ausgetragen worden sein.
  if ((await briefingStoppAdresse(a.k, dealId, stop)) !== adresse) return crewFehler("JOB_NICHT_SICHTBAR");

  return new NextResponse(new Uint8Array(e.bytes), {
    status: 200,
    headers: { ...KEIN_CACHE, "Content-Type": e.mime.startsWith("image/") ? e.mime : "image/jpeg", "Content-Length": String(e.bytes.byteLength) },
  });
}
