/**
 * Lagekarte, Chat-Vorschau: Anhänge einer Nachricht (nur Metadaten aus
 * inbox_message_attachments, nie Inhalte). Rein, ohne DB.
 */
import type { AnhangArt } from "@/lib/lagekarte/typen";

/** Nur Bilder = „foto“, sonst „datei“; ohne Anhänge null. */
export function anhangArt(anzahl: number, bilder: number): AnhangArt | null {
  if (anzahl <= 0) return null;
  return bilder >= anzahl ? "foto" : "datei";
}

/** Angezeigter Text: Text, sonst Betreff, sonst „Foto“/„Anhang“ (mit Anzahl), sonst „(ohne Text)“. */
export function nachrichtText(body: string, subject: string | null, anhaenge: number, art: AnhangArt | null): string {
  if (body.trim()) return body;
  if (subject?.trim()) return subject;
  if (anhaenge > 0) {
    if (art === "foto") return anhaenge === 1 ? "Foto" : `${anhaenge} Fotos`;
    return anhaenge === 1 ? "Anhang" : `${anhaenge} Anhänge`;
  }
  return "(ohne Text)";
}
