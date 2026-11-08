import { NextRequest, NextResponse } from "next/server";
import type { AuthContext } from "@/lib/api-utils";
import { badRequest, forbidden, getAuthContext, isReadOnlyApiKey, success, unauthorized } from "@/lib/api-utils";
import {
  autorAus,
  dealImWorkspace,
  dealNichtGefunden,
  ungueltigeVersion,
  versionAusPfad,
  versionsFehlerAntwort,
} from "@/lib/kalkulation-versionen-antwort";
import { PLAN5_FEHLER_TEXT, type TageAnbieten, type TagesRaster, type TagesSlot } from "@/lib/angebot-wahl";
import { tageSetzen, tagesRaster } from "@/services/kalkulation-versionen";

/**
 * Termin-Dialog (Plan 5b, Entscheidung 12).
 *
 * POST { von, bis } → `TagesRaster` für den Monatsraster, nichts gespeichert.
 * Höchstens 42 Tage (Grenze des Rechners). Die Antwort trägt nur die Felder
 * des Vertrags (Preis, Wochentag, Feiertag, Gründe, Aufträge, Kapazität als
 * Text, Ton und freie Namen), nie Selbstkosten, Marge oder andere Zahlen,
 * auch wenn der Dienst mehr liefert.
 *
 * PUT `TageAnbieten` → schreibt die angebotenen Tage nur in einen Entwurf
 * (aus einer gesperrten Version legt der Dienst den nächsten Entwurf an):
 * `{ version }`. Tagespreise legt nur ein Mensch fest (Agent 403).
 *
 * Beide: Deal im Workspace (sonst 404), Nur-Lese-Schlüssel 403, Fehler des
 * Dienstes mit seinem Code (wie die Nachbarrouten).
 */

const TAG = /^\d{4}-\d{2}-\d{2}$/;
const ZEIT = /^([01]\d|2[0-3]):[0-5]\d$/;
/** Grenze des Rechners für `tage`. */
const MAX_RASTER_TAGE = 42;
/** Bis 10 Tage wählbar (wie der alte Termin-Dialog). */
const MAX_TAGE = 10;
const MAX_SLOTS = 6;

type Params = { params: Promise<{ recordId: string; version: string }> };

/** Gültiges Kalenderdatum `YYYY-MM-DD` (kein 31.02.). */
function istTag(v: unknown): v is string {
  if (typeof v !== "string" || !TAG.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

function tageZwischen(von: string, bis: string): number {
  return Math.round((Date.parse(`${bis}T00:00:00Z`) - Date.parse(`${von}T00:00:00Z`)) / 86_400_000) + 1;
}

type Vorlauf = { antwort: NextResponse } | { antwort: null; ctx: AuthContext; recordId: string; version: number };

/** Gemeinsamer Vorlauf: Anmeldung, Nur-Lesen, Deal, Version. */
async function vorlauf(req: NextRequest, { params }: Params): Promise<Vorlauf> {
  const ctx = await getAuthContext(req);
  if (!ctx) return { antwort: unauthorized(req) };
  if (isReadOnlyApiKey(ctx)) return { antwort: forbidden("Nur-Lese-Schlüssel hat keinen Zugriff auf den Termin-Dialog.") };
  const { recordId, version: segment } = await params;
  if (!(await dealImWorkspace(ctx.workspaceId, recordId))) return { antwort: dealNichtGefunden() };
  const version = versionAusPfad(segment);
  if (version === null) return { antwort: ungueltigeVersion() };
  return { antwort: null, ctx, recordId, version };
}

/** Nur die Felder des Vertrags; interne Zahlen des Dienstes fallen weg. */
function rasterFuerAntwort(r: TagesRaster): TagesRaster {
  return {
    von: r.von,
    bis: r.bis,
    zellen: r.zellen.map((z) => ({
      datum: z.datum,
      wochentag: z.wochentag,
      feiertag: z.feiertag,
      preisCent: z.preisCent,
      gruende: z.gruende.map((g) => ({ text: g.text, punkte: g.punkte })),
      auftraege: z.auftraege.map((a) => ({ dealId: a.dealId, name: a.name })),
      ...(z.kapazitaet
        ? { kapazitaet: { text: z.kapazitaet.text, ton: z.kapazitaet.ton, frei: [...z.kapazitaet.frei] } }
        : {}),
      vergangen: z.vergangen,
    })),
    wunschtermin: {
      datum: r.wunschtermin.datum,
      quelle: r.wunschtermin.quelle,
      weitere: [...r.wunschtermin.weitere],
    },
    hinweis: r.hinweis,
  };
}

export async function POST(req: NextRequest, p: Params): Promise<NextResponse> {
  const v = await vorlauf(req, p);
  if (v.antwort) return v.antwort;

  const body: unknown = await req.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) return badRequest("Body muss ein JSON-Objekt sein.");
  const { von, bis } = body as Record<string, unknown>;
  if (!istTag(von) || !istTag(bis)) return badRequest("von und bis müssen Tage im Format JJJJ-MM-TT sein.");
  if (bis < von) return badRequest("bis darf nicht vor von liegen.");
  if (tageZwischen(von, bis) > MAX_RASTER_TAGE) return badRequest(`Höchstens ${MAX_RASTER_TAGE} Tage auf einmal.`);

  try {
    const raster = await tagesRaster(v.ctx.workspaceId, v.recordId, v.version, von, bis);
    return success(rasterFuerAntwort(raster));
  } catch (err) {
    const antwort = versionsFehlerAntwort(err);
    if (antwort) return antwort;
    throw err;
  }
}

/** `TageAnbieten` aus dem Body; ein Text = Fehlermeldung für 400. */
function tageAnbietenAus(body: unknown): TageAnbieten | string {
  if (!body || typeof body !== "object" || Array.isArray(body)) return "Body muss ein JSON-Objekt sein.";
  const b = body as Record<string, unknown>;
  if (!Array.isArray(b.tage)) return "tage muss eine Liste sein.";
  if (b.tage.length > MAX_TAGE) return `Höchstens ${MAX_TAGE} Tage.`;
  const roheUebersteuerungen = b.uebersteuerungen === undefined ? [] : b.uebersteuerungen;
  if (!Array.isArray(roheUebersteuerungen)) return "uebersteuerungen muss eine Liste sein.";

  const tage: TageAnbieten["tage"] = [];
  for (const roh of b.tage) {
    if (!roh || typeof roh !== "object") return "Jeder Tag muss ein Objekt sein.";
    const t = roh as Record<string, unknown>;
    if (!istTag(t.datum)) return `Ungültiger Tag: ${String(t.datum)}`;
    if (tage.some((x) => x.datum === t.datum)) return `Tag doppelt: ${t.datum}`;
    if (!Array.isArray(t.slots) || t.slots.length === 0) return `Jeder Tag braucht mindestens ein Zeitfenster (${t.datum}).`;
    if (t.slots.length > MAX_SLOTS) return `Höchstens ${MAX_SLOTS} Zeitfenster je Tag (${t.datum}).`;
    const slots: TagesSlot[] = [];
    for (const s of t.slots as unknown[]) {
      const z = (s && typeof s === "object" ? s : {}) as Record<string, unknown>;
      const label = typeof z.label === "string" ? z.label.trim() : "";
      if (!label || label.length > 80) return `Jedes Zeitfenster braucht eine Bezeichnung bis 80 Zeichen (${t.datum}).`;
      const startTime = z.startTime === undefined || z.startTime === null || z.startTime === "" ? null : z.startTime;
      const endTime = z.endTime === undefined || z.endTime === null || z.endTime === "" ? null : z.endTime;
      if ((startTime !== null && (typeof startTime !== "string" || !ZEIT.test(startTime))) || (endTime !== null && (typeof endTime !== "string" || !ZEIT.test(endTime)))) {
        return `Uhrzeit im Format HH:MM (${t.datum}).`;
      }
      slots.push({ label, startTime: startTime as string | null, endTime: endTime as string | null });
    }
    if (t.note !== undefined && t.note !== null && typeof t.note !== "string") return `Notiz muss ein Text sein (${t.datum}).`;
    const note = typeof t.note === "string" && t.note.trim() ? t.note.trim() : null;
    if (note && note.length > 200) return `Notiz höchstens 200 Zeichen (${t.datum}).`;
    if (t.empfohlen !== undefined && typeof t.empfohlen !== "boolean") return `empfohlen muss ja oder nein sein (${t.datum}).`;
    tage.push({ datum: t.datum, slots, note, empfohlen: t.empfohlen === true });
  }
  if (tage.filter((t) => t.empfohlen).length > 1) return "Höchstens ein Tag ist die Empfehlung.";

  const uebersteuerungen: TageAnbieten["uebersteuerungen"] = [];
  for (const roh of roheUebersteuerungen) {
    if (!roh || typeof roh !== "object") return "Jede Preis-Anpassung muss ein Objekt sein.";
    const u = roh as Record<string, unknown>;
    if (!istTag(u.datum) || !tage.some((t) => t.datum === u.datum)) return "Preis-Anpassung nur für einen angebotenen Tag.";
    if (u.paketSlug !== undefined && u.paketSlug !== null && (typeof u.paketSlug !== "string" || !u.paketSlug.trim())) {
      return "paketSlug muss ein Text oder leer sein.";
    }
    if (typeof u.betrag !== "number" || !Number.isFinite(u.betrag) || u.betrag <= 0) return "betrag muss eine Zahl über 0 sein (Euro).";
    if (typeof u.grund !== "string" || !u.grund.trim()) return "Eine Preis-Anpassung braucht einen Grund.";
    const paketSlug = typeof u.paketSlug === "string" ? u.paketSlug.trim() : null;
    if (uebersteuerungen.some((x) => x.datum === u.datum && x.paketSlug === paketSlug)) {
      return `Preis-Anpassung doppelt: ${u.datum}${paketSlug ? ` ${paketSlug}` : ""}`;
    }
    uebersteuerungen.push({ datum: u.datum, paketSlug, betrag: u.betrag, grund: u.grund.trim() });
  }
  return { tage, uebersteuerungen };
}

export async function PUT(req: NextRequest, p: Params): Promise<NextResponse> {
  const v = await vorlauf(req, p);
  if (v.antwort) return v.antwort;
  // F19: Tagespreise nur durch Menschen.
  if (v.ctx.authMethod === "api_key") return forbidden(PLAN5_FEHLER_TEXT.TAGESPREIS_NUR_MENSCH);

  const eingabe = tageAnbietenAus(await req.json().catch(() => null));
  if (typeof eingabe === "string") return badRequest(eingabe);

  try {
    const version = await tageSetzen(v.ctx.workspaceId, v.recordId, v.version, autorAus(v.ctx), eingabe);
    return success({ version });
  } catch (err) {
    const antwort = versionsFehlerAntwort(err);
    if (antwort) return antwort;
    throw err;
  }
}
