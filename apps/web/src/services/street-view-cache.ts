/**
 * Street View je Workspace und Adresse mit Cache (Plan 4, Entscheidung 7).
 *
 * - Bild privat im Blob unter `ws/{ws}/street-view/{schluessel}.jpg`, höchstens
 *   30 Tage gültig, danach beim nächsten Ansehen neu holen. Dauerhaft bleibt nur
 *   die `pano_id` (für den 360°-Link).
 * - "kein_bild" wird 30 Tage gemerkt, "fehler" frühestens nach 1 Stunde neu versucht.
 * - Nur bei genauer Adresse (`adresseGenau`); sonst kein Google-Abruf.
 * - `darfAbrufen: false` (Nur-Lesen-Schlüssel): nur gespeicherter Stand, kein
 *   Abruf, kein Schreiben.
 *
 * Der Speicher ist austauschbar (Tests ohne Datenbank); die Vorgabe
 * (`street-view-speicher.ts`) lädt `@/db` erst beim Aufruf.
 */
import { put } from "@vercel/blob";
import { adresseGenau } from "@/lib/adresse-genau";
import { fetchStreetView, StreetViewConfigError, streetViewSchluessel } from "@/services/street-view";

export const STREET_VIEW_GUELTIG_MS = 30 * 24 * 60 * 60 * 1000;
export const STREET_VIEW_FEHLER_PAUSE_MS = 60 * 60 * 1000;
export const STREET_VIEW_BREITE = 640;
export const STREET_VIEW_HOEHE = 400;

export type StreetViewStatus = "ok" | "kein_bild" | "fehler" | "ohne_schluessel" | "nicht_geladen";

export interface StreetViewGespeichert {
  workspaceId: string;
  adresseSchluessel: string;
  adresse: string;
  status: "ok" | "kein_bild" | "fehler";
  blobPfad: string | null;
  panoId: string | null;
  geholtAm: Date;
  notiz: string | null;
  /** Name des Notiz-Autors (aus `users`), sonst null. */
  notizVonName: string | null;
  notizAm: Date | null;
}

export interface StreetViewSpeicher {
  lesen(ws: string, schluessel: string): Promise<StreetViewGespeichert | null>;
  /** Upsert je (workspace_id, adresse_schluessel); die Notiz bleibt unberührt. */
  schreiben(z: Omit<StreetViewGespeichert, "notiz" | "notizVonName" | "notizAm">): Promise<void>;
  /** Setzt (oder leert mit null) die Notiz einer vorhandenen Zeile; false, wenn es keine gibt. */
  notizSetzen(ws: string, schluessel: string, text: string | null, userId: string): Promise<boolean>;
}

export interface StreetViewErgebnis {
  status: StreetViewStatus;
  schluessel: string;
  panoLink: string | null;
  notiz: { text: string; von: string; am: string } | null;
}

export interface StreetViewOptionen {
  darfAbrufen: boolean;
  speicher?: StreetViewSpeicher;
  jetzt?: () => Date;
}

export function blobPfadFuer(ws: string, schluessel: string): string {
  return `ws/${ws}/street-view/${schluessel}.jpg`;
}

export function panoLinkFuer(panoId: string | null): string | null {
  return panoId ? `https://www.google.com/maps/@?api=1&map_action=pano&pano=${encodeURIComponent(panoId)}` : null;
}

export function notizAus(z: StreetViewGespeichert | null): StreetViewErgebnis["notiz"] {
  if (!z?.notiz) return null;
  return { text: z.notiz, von: z.notizVonName ?? "", am: (z.notizAm ?? z.geholtAm).toISOString() };
}

/** Darf der gespeicherte Stand ohne neuen Abruf gezeigt werden? */
export function nochGueltig(z: Pick<StreetViewGespeichert, "status" | "geholtAm">, jetzt: Date): boolean {
  const alter = jetzt.getTime() - z.geholtAm.getTime();
  if (z.status === "fehler") return alter < STREET_VIEW_FEHLER_PAUSE_MS;
  return alter < STREET_VIEW_GUELTIG_MS;
}

export async function streetViewFuer(ws: string, adresse: string, opts: StreetViewOptionen): Promise<StreetViewErgebnis> {
  const a = adresseGenau(adresse);
  const schluessel = a.schluessel ?? "";
  // Ungenaue Adresse: nie abrufen (Review Focus 1). Die Route fängt das vorher ab.
  if (!a.genau || !a.text || !a.schluessel) return { status: "nicht_geladen", schluessel, panoLink: null, notiz: null };

  const speicher = opts.speicher ?? (await standardSpeicher());
  const jetzt = (opts.jetzt ?? (() => new Date()))();
  const vorher = await speicher.lesen(ws, a.schluessel);
  const ergebnis = (status: StreetViewStatus, panoId: string | null): StreetViewErgebnis => ({
    status,
    schluessel: a.schluessel!,
    panoLink: panoLinkFuer(panoId),
    notiz: notizAus(vorher),
  });

  if (vorher && nochGueltig(vorher, jetzt)) return ergebnis(vorher.status, vorher.panoId);
  if (!opts.darfAbrufen) {
    // Abgelaufenes Bild wird nicht mehr gezeigt; "kein_bild"/"fehler" bleiben als gespeicherter Stand.
    if (!vorher || vorher.status === "ok") return ergebnis("nicht_geladen", vorher?.panoId ?? null);
    return ergebnis(vorher.status, vorher.panoId);
  }
  if (!streetViewSchluessel()) return ergebnis("ohne_schluessel", vorher?.panoId ?? null);

  const basis = { workspaceId: ws, adresseSchluessel: a.schluessel, adresse: a.text, geholtAm: jetzt };
  let bild: Awaited<ReturnType<typeof fetchStreetView>>;
  try {
    bild = await fetchStreetView({ address: a.text, width: STREET_VIEW_BREITE, height: STREET_VIEW_HOEHE });
  } catch (e) {
    if (e instanceof StreetViewConfigError) return ergebnis("ohne_schluessel", vorher?.panoId ?? null);
    console.error("[street-view] Abruf", e);
    await speicher.schreiben({ ...basis, status: "fehler", blobPfad: null, panoId: vorher?.panoId ?? null });
    return ergebnis("fehler", vorher?.panoId ?? null);
  }
  if (!bild) {
    await speicher.schreiben({ ...basis, status: "kein_bild", blobPfad: null, panoId: null });
    return ergebnis("kein_bild", null);
  }
  const pfad = blobPfadFuer(ws, a.schluessel);
  const panoId = bild.panoId ?? vorher?.panoId ?? null;
  try {
    await put(pfad, bild.bytes, {
      access: "private",
      allowOverwrite: true,
      addRandomSuffix: false,
      contentType: bild.mime,
    });
  } catch (e) {
    console.error("[street-view] Blob", e);
    await speicher.schreiben({ ...basis, status: "fehler", blobPfad: null, panoId });
    return ergebnis("fehler", panoId);
  }
  await speicher.schreiben({ ...basis, status: "ok", blobPfad: pfad, panoId });
  return ergebnis("ok", panoId);
}

/** Gespeicherte Zeile für die Bild-Route: nur gültige Bilder (30 Tage). */
export async function streetViewBildPfad(
  ws: string,
  schluessel: string,
  opts: { speicher?: StreetViewSpeicher; jetzt?: () => Date } = {}
): Promise<string | null> {
  if (!/^[0-9a-f]{64}$/.test(schluessel)) return null;
  const speicher = opts.speicher ?? (await standardSpeicher());
  const z = await speicher.lesen(ws, schluessel);
  const jetzt = (opts.jetzt ?? (() => new Date()))();
  if (!z || z.status !== "ok" || !z.blobPfad || !nochGueltig(z, jetzt)) return null;
  return z.blobPfad;
}

async function standardSpeicher(): Promise<StreetViewSpeicher> {
  return (await import("@/services/street-view-speicher")).dbStreetViewSpeicher();
}
