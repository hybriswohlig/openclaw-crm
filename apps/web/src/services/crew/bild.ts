/**
 * Fotos für die Crew immer neu kodieren: nach EXIF-Ausrichtung drehen, auf
 * höchstens 1000 px lange Kante verkleinern, WebP (Qualität 75). sharp
 * schreibt ohne `withMetadata()` keine Metadaten, also kein EXIF, kein GPS,
 * keine Kamera. Eingang hart begrenzt, Ausgang deutlich unter 4 MB.
 * Kleiner Speicher-Cache je Foto und Freigabe-Zeitpunkt.
 */
import sharp from "sharp";

export const FOTO_EINGANG_MAX_BYTES = 15 * 1024 * 1024;
export const FOTO_AUSGANG_MAX_BYTES = 4 * 1024 * 1024;
export const FOTO_KANTE_MAX = 1000;
/** Schutz gegen Pixel-Bomben (z. B. 20 000 × 20 000 in einer kleinen Datei). */
const PIXEL_MAX = 80_000_000;

/** Byte-Größe eines base64-Inhalts ohne zu dekodieren. */
export function base64Groesse(b64: string): number {
  const ohne = b64.replace(/\s/g, "");
  const rand = ohne.endsWith("==") ? 2 : ohne.endsWith("=") ? 1 : 0;
  return Math.floor((ohne.length * 3) / 4) - rand;
}

/** Neu kodiert als WebP, ohne Metadaten. null bei zu groß, kaputt oder kein Bild. */
export async function crewFotoUmwandeln(eingang: Uint8Array): Promise<Buffer | null> {
  if (eingang.byteLength === 0 || eingang.byteLength > FOTO_EINGANG_MAX_BYTES) return null;
  try {
    const aus = await sharp(eingang, { limitInputPixels: PIXEL_MAX, failOn: "error", animated: false })
      .rotate()
      .resize({ width: FOTO_KANTE_MAX, height: FOTO_KANTE_MAX, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 75 })
      .toBuffer();
    return aus.byteLength > 0 && aus.byteLength < FOTO_AUSGANG_MAX_BYTES ? aus : null;
  } catch {
    return null;
  }
}

// ─── Cache (nur in diesem Prozess) ───────────────────────────────────────────

const CACHE_EINTRAEGE = 60;
const CACHE_BYTES = 30 * 1024 * 1024;
const cache = new Map<string, Buffer>();
let cacheBytes = 0;

export function cacheLesen(schluessel: string): Buffer | null {
  const b = cache.get(schluessel);
  if (!b) return null;
  cache.delete(schluessel);
  cache.set(schluessel, b);
  return b;
}

export function cacheSchreiben(schluessel: string, b: Buffer): void {
  const alt = cache.get(schluessel);
  if (alt) {
    cacheBytes -= alt.byteLength;
    cache.delete(schluessel);
  }
  cache.set(schluessel, b);
  cacheBytes += b.byteLength;
  while (cache.size > CACHE_EINTRAEGE || cacheBytes > CACHE_BYTES) {
    const [k, v] = cache.entries().next().value as [string, Buffer];
    cache.delete(k);
    cacheBytes -= v.byteLength;
  }
}
