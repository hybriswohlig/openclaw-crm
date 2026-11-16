/**
 * Fotos eines Deals für die Crew. Quellen: Bildanhänge im Chat
 * (`inbox_message_attachments`, base64; dort liegen fast alle Kundenfotos),
 * Agenten-Fotos (`deal_internal_photos`, base64) und Einsatz-Fotos
 * (`job_media`, privater Blob). Die Crew sieht nur Fotos mit
 * `crew_freigegeben_at`; jede Auslieferung prüft erneut, ob der Job für diesen
 * Link sichtbar ist. Keine Verkleinerung (kein Bildwerkzeug im Projekt): das
 * Original geht raus, `Cache-Control: private, max-age=3600`.
 */
import { get } from "@vercel/blob";
import { and, eq, isNotNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { dealInternalPhotos, inboxMessageAttachments, jobMedia } from "@/db/schema";
import type { CrewKontext } from "./auth";
import { CREW_FOTO_TYPEN, ladeCrewJobs } from "./jobs";

export const CREW_FOTO_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

const erlaubt = (mime: string | null | undefined) => (CREW_FOTO_TYPEN as readonly string[]).includes((mime ?? "").toLowerCase());
const typNorm = (mime: string) => (mime.toLowerCase() === "image/jpg" ? "image/jpeg" : mime.toLowerCase());

type Quelle =
  | { art: "base64"; dealId: string; mime: string; inhalt: string }
  | { art: "blob"; dealId: string; mime: string; pfad: string };

/** Freigegebenes Foto im Workspace finden (Metadaten zuerst, Inhalt erst danach). */
async function freigegebenesFoto(ws: string, id: string): Promise<{ tabelle: "chat" | "intern" | "einsatz"; dealId: string; mime: string } | null> {
  const [a] = await db
    .select({ dealId: inboxMessageAttachments.dealRecordId, mime: inboxMessageAttachments.mimeType })
    .from(inboxMessageAttachments)
    .where(and(eq(inboxMessageAttachments.id, id), eq(inboxMessageAttachments.workspaceId, ws), isNotNull(inboxMessageAttachments.crewFreigegebenAt)))
    .limit(1);
  if (a?.dealId) return { tabelle: "chat", dealId: a.dealId, mime: a.mime };
  const [p] = await db
    .select({ dealId: dealInternalPhotos.dealRecordId, mime: dealInternalPhotos.mimeType })
    .from(dealInternalPhotos)
    .where(and(eq(dealInternalPhotos.id, id), eq(dealInternalPhotos.workspaceId, ws), isNotNull(dealInternalPhotos.crewFreigegebenAt)))
    .limit(1);
  if (p) return { tabelle: "intern", dealId: p.dealId, mime: p.mime };
  const [m] = await db
    .select({ dealId: jobMedia.dealRecordId, mime: jobMedia.contentType })
    .from(jobMedia)
    .where(and(eq(jobMedia.id, id), eq(jobMedia.workspaceId, ws), isNotNull(jobMedia.crewFreigegebenAt)))
    .limit(1);
  if (m?.dealId) return { tabelle: "einsatz", dealId: m.dealId, mime: m.mime };
  return null;
}

async function quelleLaden(ws: string, id: string, f: { tabelle: "chat" | "intern" | "einsatz"; dealId: string; mime: string }): Promise<Quelle | null> {
  if (f.tabelle === "chat") {
    const [z] = await db
      .select({ inhalt: inboxMessageAttachments.fileContent })
      .from(inboxMessageAttachments)
      .where(and(eq(inboxMessageAttachments.id, id), eq(inboxMessageAttachments.workspaceId, ws)))
      .limit(1);
    return z ? { art: "base64", dealId: f.dealId, mime: f.mime, inhalt: z.inhalt } : null;
  }
  if (f.tabelle === "intern") {
    const [z] = await db
      .select({ inhalt: dealInternalPhotos.fileContent })
      .from(dealInternalPhotos)
      .where(and(eq(dealInternalPhotos.id, id), eq(dealInternalPhotos.workspaceId, ws)))
      .limit(1);
    return z ? { art: "base64", dealId: f.dealId, mime: f.mime, inhalt: z.inhalt } : null;
  }
  const [z] = await db
    .select({ pfad: jobMedia.blobPathname })
    .from(jobMedia)
    .where(and(eq(jobMedia.id, id), eq(jobMedia.workspaceId, ws)))
    .limit(1);
  return z ? { art: "blob", dealId: f.dealId, mime: f.mime, pfad: z.pfad } : null;
}

export type CrewFotoErgebnis = { ok: true; body: BodyInit; contentType: string } | { ok: false };

/** Bytes eines freigegebenen Fotos, nur wenn sein Job für diesen Link sichtbar ist. */
export async function crewFotoLaden(k: CrewKontext, fotoId: string, o: { jetzt?: Date } = {}): Promise<CrewFotoErgebnis> {
  if (!CREW_FOTO_ID_RE.test(fotoId)) return { ok: false };
  const f = await freigegebenesFoto(k.workspaceId, fotoId);
  if (!f || !erlaubt(f.mime)) return { ok: false };
  const [job] = await ladeCrewJobs(k, { dealIds: [f.dealId], jetzt: o.jetzt });
  if (!job || !job.photos.some((p) => p.id === fotoId)) return { ok: false };
  const q = await quelleLaden(k.workspaceId, fotoId, f);
  if (!q) return { ok: false };
  if (q.art === "base64") {
    const roh = q.inhalt.includes(",") && q.inhalt.startsWith("data:") ? q.inhalt.slice(q.inhalt.indexOf(",") + 1) : q.inhalt;
    const bytes = Buffer.from(roh, "base64");
    if (bytes.length === 0) return { ok: false };
    return { ok: true, body: new Uint8Array(bytes), contentType: typNorm(q.mime) };
  }
  const r = await get(q.pfad, { access: "private" });
  if (!r || r.statusCode !== 200 || !r.stream) return { ok: false };
  return { ok: true, body: r.stream, contentType: typNorm(q.mime) };
}

// ─── Freigabe (Inhaber) ──────────────────────────────────────────────────────

export type FreigabeErgebnis = { ok: true; crewFreigegebenAt: string | null } | { ok: false; code: "NICHT_GEFUNDEN" | "KEIN_BILD" };

/**
 * „Für Crew freigeben“ an einem Foto des Deals (gleich, in welcher Tabelle es
 * liegt). Nur Bilder; das Foto muss zu diesem Deal und Workspace gehören.
 */
export async function crewFotoFreigeben(
  ws: string,
  dealId: string,
  fotoId: string,
  freigegeben: boolean,
  autor: string,
): Promise<FreigabeErgebnis> {
  const am = freigegeben ? new Date() : null;
  const von = freigegeben ? autor : null;
  const tabellen = [
    { t: inboxMessageAttachments, mime: inboxMessageAttachments.mimeType },
    { t: dealInternalPhotos, mime: dealInternalPhotos.mimeType },
    { t: jobMedia, mime: jobMedia.contentType },
  ] as const;
  for (const { t, mime } of tabellen) {
    const [z] = await db
      .select({ mime })
      .from(t)
      .where(and(eq(t.id, fotoId), eq(t.workspaceId, ws), eq(t.dealRecordId, dealId)))
      .limit(1);
    if (!z) continue;
    if (!z.mime.toLowerCase().startsWith("image/")) return { ok: false, code: "KEIN_BILD" };
    const [neu] = await db
      .update(t)
      .set({
        // Erste Freigabe bleibt stehen, wenn erneut freigegeben wird.
        crewFreigegebenAt: am ? sql`coalesce(${t.crewFreigegebenAt}, ${am.toISOString()}::timestamptz)` : null,
        crewFreigegebenBy: von ? sql`coalesce(${t.crewFreigegebenBy}, ${von})` : null,
      })
      .where(and(eq(t.id, fotoId), eq(t.workspaceId, ws)))
      .returning({ at: t.crewFreigegebenAt });
    return { ok: true, crewFreigegebenAt: neu?.at ? new Date(neu.at).toISOString() : null };
  }
  return { ok: false, code: "NICHT_GEFUNDEN" };
}
