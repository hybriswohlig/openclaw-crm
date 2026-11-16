/**
 * Fotos eines Deals für die Crew. Quellen: Bildanhänge im Chat
 * (`inbox_message_attachments`, base64; dort liegen fast alle Kundenfotos),
 * Agenten-Fotos (`deal_internal_photos`, base64) und Einsatz-Fotos
 * (`job_media`, privater Blob). Die Crew sieht nur freigegebene Fotos in
 * erlaubtem Format (`CREW_FOTO_TYPEN`).
 *
 * Auslieferung: (1) freigegebenes Foto → Deal, (2) Deal für diesen Link
 * sichtbar (schmale Prüfung, keine Jobliste), (3) Bytes lesen mit Deal,
 * Freigabe und Format in derselben Abfrage (ein zwischendurch umgehängter
 * oder zurückgezogener Anhang liefert nichts), (4) immer neu kodieren
 * (`./bild.ts`: ohne EXIF/GPS, max. 1000 px, WebP).
 */
import { get } from "@vercel/blob";
import { and, eq, isNotNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { dealInternalPhotos, inboxMessageAttachments, jobMedia } from "@/db/schema";
import type { CrewKontext } from "./auth";
import { base64Groesse, cacheLesen, cacheSchreiben, crewFotoUmwandeln, FOTO_EINGANG_MAX_BYTES } from "./bild";
import { CREW_FOTO_TYPEN, crewFotoTypErlaubt, dealSichtbar } from "./jobs";

export const CREW_FOTO_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

type Tabelle = "chat" | "intern" | "einsatz";
const TYPEN = sql`${sql.param([...CREW_FOTO_TYPEN])}::text[]`;

/** Schritt 1: freigegebenes Foto in erlaubtem Format → Deal und Freigabe-Zeitpunkt (eine Abfrage). */
export async function freigegebenesFoto(ws: string, id: string): Promise<{ tabelle: Tabelle; dealId: string; am: string } | null> {
  const res = await db.execute(sql`
    SELECT 'chat' AS tabelle, a.deal_record_id AS deal_id, a.crew_freigegeben_at::text AS am FROM inbox_message_attachments a
    WHERE a.id = ${id} AND a.workspace_id = ${ws} AND a.crew_freigegeben_at IS NOT NULL AND a.deal_record_id IS NOT NULL AND lower(a.mime_type) = ANY(${TYPEN})
    UNION ALL
    SELECT 'intern', p.deal_record_id, p.crew_freigegeben_at::text FROM deal_internal_photos p
    WHERE p.id = ${id} AND p.workspace_id = ${ws} AND p.crew_freigegeben_at IS NOT NULL AND lower(p.mime_type) = ANY(${TYPEN})
    UNION ALL
    SELECT 'einsatz', m.deal_record_id, m.crew_freigegeben_at::text FROM job_media m
    WHERE m.id = ${id} AND m.workspace_id = ${ws} AND m.crew_freigegeben_at IS NOT NULL AND m.deal_record_id IS NOT NULL AND lower(m.content_type) = ANY(${TYPEN})
    LIMIT 1
  `);
  const [z] = (Array.isArray(res) ? res : ((res as { rows?: unknown[] }).rows ?? [])) as Array<{ tabelle: Tabelle; deal_id: string; am: string }>;
  return z ? { tabelle: z.tabelle, dealId: z.deal_id, am: z.am } : null;
}

type Quelle = { art: "base64"; inhalt: string } | { art: "blob"; pfad: string } | { art: "gueltig" };

/**
 * Schritt 3: Inhalt nur, wenn das Foto noch an diesem Deal hängt, freigegeben
 * und im Format ist (alles in derselben Abfrage). `mitInhalt: false` prüft nur
 * (für einen Cache-Treffer), ohne den Inhalt zu lesen.
 */
export async function fotoQuelleLesen(ws: string, id: string, dealId: string, tabelle: Tabelle, mitInhalt = true): Promise<Quelle | null> {
  if (tabelle === "chat") {
    const t = inboxMessageAttachments;
    const [z] = await db
      .select({ inhalt: mitInhalt ? t.fileContent : sql<string>`''` })
      .from(t)
      .where(and(eq(t.id, id), eq(t.workspaceId, ws), eq(t.dealRecordId, dealId), isNotNull(t.crewFreigegebenAt), sql`lower(${t.mimeType}) = ANY(${TYPEN})`))
      .limit(1);
    return z ? (mitInhalt ? { art: "base64", inhalt: z.inhalt } : { art: "gueltig" }) : null;
  }
  if (tabelle === "intern") {
    const t = dealInternalPhotos;
    const [z] = await db
      .select({ inhalt: mitInhalt ? t.fileContent : sql<string>`''` })
      .from(t)
      .where(and(eq(t.id, id), eq(t.workspaceId, ws), eq(t.dealRecordId, dealId), isNotNull(t.crewFreigegebenAt), sql`lower(${t.mimeType}) = ANY(${TYPEN})`))
      .limit(1);
    return z ? (mitInhalt ? { art: "base64", inhalt: z.inhalt } : { art: "gueltig" }) : null;
  }
  const t = jobMedia;
  const [z] = await db
    .select({ pfad: t.blobPathname, groesse: t.sizeBytes })
    .from(t)
    .where(and(eq(t.id, id), eq(t.workspaceId, ws), eq(t.dealRecordId, dealId), isNotNull(t.crewFreigegebenAt), sql`lower(${t.contentType}) = ANY(${TYPEN})`))
    .limit(1);
  if (!z || z.groesse > FOTO_EINGANG_MAX_BYTES) return null;
  return mitInhalt ? { art: "blob", pfad: z.pfad } : { art: "gueltig" };
}

/** Blob lesen, beim Überschreiten der Grenze abbrechen. */
async function blobLesen(pfad: string): Promise<Uint8Array | null> {
  const r = await get(pfad, { access: "private" });
  if (!r || r.statusCode !== 200 || !r.stream) return null;
  const reader = r.stream.getReader();
  const teile: Uint8Array[] = [];
  let summe = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    summe += value.byteLength;
    if (summe > FOTO_EINGANG_MAX_BYTES) {
      await reader.cancel().catch(() => {});
      return null;
    }
    teile.push(value);
  }
  return Buffer.concat(teile);
}

export type CrewFotoErgebnis = { ok: true; body: Uint8Array; contentType: "image/webp" } | { ok: false };

/** Neu kodierte Bytes eines freigegebenen Fotos, nur wenn sein Job für diesen Link sichtbar ist. */
export async function crewFotoLaden(k: CrewKontext, fotoId: string, o: { jetzt?: Date } = {}): Promise<CrewFotoErgebnis> {
  if (!CREW_FOTO_ID_RE.test(fotoId)) return { ok: false };
  const f = await freigegebenesFoto(k.workspaceId, fotoId);
  if (!f) return { ok: false };
  if (!(await dealSichtbar(k, f.dealId, { jetzt: o.jetzt }))) return { ok: false };
  const schluessel = `${fotoId}:${f.dealId}:${f.am}`;
  const gemerkt = cacheLesen(schluessel);
  const q = await fotoQuelleLesen(k.workspaceId, fotoId, f.dealId, f.tabelle, !gemerkt);
  if (!q) return { ok: false };
  if (gemerkt) return { ok: true, body: new Uint8Array(gemerkt), contentType: "image/webp" };
  let roh: Uint8Array | null;
  if (q.art === "gueltig") return { ok: false };
  if (q.art === "base64") {
    const b64 = q.inhalt.startsWith("data:") && q.inhalt.includes(",") ? q.inhalt.slice(q.inhalt.indexOf(",") + 1) : q.inhalt;
    roh = base64Groesse(b64) > FOTO_EINGANG_MAX_BYTES ? null : Buffer.from(b64, "base64");
  } else {
    roh = await blobLesen(q.pfad);
  }
  if (!roh) return { ok: false };
  const aus = await crewFotoUmwandeln(roh);
  if (!aus) return { ok: false };
  cacheSchreiben(schluessel, aus);
  return { ok: true, body: new Uint8Array(aus), contentType: "image/webp" };
}

// ─── Freigabe (Inhaber) ──────────────────────────────────────────────────────

export const FREIGABE_FORMAT_TEXT = "Nur JPEG, PNG, WebP oder GIF lassen sich für die Crew freigeben (kein HEIC, kein SVG).";

export type FreigabeErgebnis = { ok: true; crewFreigegebenAt: string | null } | { ok: false; code: "NICHT_GEFUNDEN" | "FORMAT" };

/**
 * „Für Crew freigeben“ an einem Foto des Deals (gleich, in welcher Tabelle).
 * Workspace, Deal und Format stehen im UPDATE selbst; ein umgehängtes Foto
 * wird nicht freigegeben. Erste Freigabe bleibt bei erneutem Freigeben stehen.
 */
export async function crewFotoFreigeben(
  ws: string,
  dealId: string,
  fotoId: string,
  freigegeben: boolean,
  autor: string,
): Promise<FreigabeErgebnis> {
  const am = new Date().toISOString();
  const tabellen = [
    { t: inboxMessageAttachments, mime: inboxMessageAttachments.mimeType },
    { t: dealInternalPhotos, mime: dealInternalPhotos.mimeType },
    { t: jobMedia, mime: jobMedia.contentType },
  ] as const;
  for (const { t, mime } of tabellen) {
    const [neu] = await db
      .update(t)
      .set({
        crewFreigegebenAt: freigegeben ? sql`coalesce(${t.crewFreigegebenAt}, ${am}::timestamptz)` : null,
        crewFreigegebenBy: freigegeben ? sql`coalesce(${t.crewFreigegebenBy}, ${autor})` : null,
      })
      .where(
        and(
          eq(t.id, fotoId),
          eq(t.workspaceId, ws),
          eq(t.dealRecordId, dealId),
          // Zurücknehmen geht immer, Freigeben nur im erlaubten Format.
          freigegeben ? sql`lower(${mime}) = ANY(${TYPEN})` : sql`true`,
        ),
      )
      .returning({ at: t.crewFreigegebenAt });
    if (neu) return { ok: true, crewFreigegebenAt: neu.at ? new Date(neu.at).toISOString() : null };
    // Gibt es das Foto an diesem Deal, nur im falschen Format?
    const [da] = await db
      .select({ mime })
      .from(t)
      .where(and(eq(t.id, fotoId), eq(t.workspaceId, ws), eq(t.dealRecordId, dealId)))
      .limit(1);
    if (da) return crewFotoTypErlaubt(da.mime) ? { ok: false, code: "NICHT_GEFUNDEN" } : { ok: false, code: "FORMAT" };
  }
  return { ok: false, code: "NICHT_GEFUNDEN" };
}
