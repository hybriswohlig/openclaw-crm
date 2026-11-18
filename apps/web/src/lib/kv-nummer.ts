/**
 * KV-Nummer des VPS im Dateinamen („KV-KO-20261110-ART-3“), sonst keine (Plan 16, Review M5).
 * Rein; genutzt von der Akte-Dokumentliste und vom KV-Editor (Renderer eines Altbestands, Spec 7.4).
 * CRM-Dateinamen („KV-ceylan-2026-11-18-ab12cd34.pdf“) tragen keine Nummer.
 */
export function kvNummer(fileName: string): string | null {
  const m = /^(KV-[A-Z]{2,}-\d{8}-[A-Z0-9]+(?:-\d+)?)(?:\.pdf)?$/i.exec(fileName.trim());
  return m ? m[1] : null;
}
