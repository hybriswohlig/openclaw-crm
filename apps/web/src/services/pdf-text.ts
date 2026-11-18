/**
 * Text eines PDFs lesen (KV-Editor, Preisprüfung der VPS-PDFs, Spec 7.3).
 *
 * `unpdf` (pdf.js ohne Worker, exakt gepinnt). Die Seiten kommen in Lesereihenfolge von
 * pdf.js und werden mit einem Seitenvorschub (`\f`) verbunden: In den VPS-KVs steht die
 * Kopfzeile „Vertragsunterlagen“ im Text erst hinter dem Inhalt ihrer Seite, die
 * Preisprüfung schneidet darum am Anfang dieser Seite (`vpsPreisPruefung`).
 * Glyphen von Ligaturen (tt, ff) erscheinen als Zeichen aus dem privaten Bereich; Beträge
 * enthalten keine.
 */
import { extractText } from "unpdf";

export const PDF_SEITENTRENNER = "\f";

/** Wirft bei kaputtem oder verschlüsseltem PDF; der Aufrufer wertet das als „nicht lesbar“. */
export async function pdfText(bytes: Uint8Array): Promise<string> {
  // pdf.js übernimmt den Puffer; eine Kopie hält die Bytes des Aufrufers unverändert.
  const { text } = await extractText(new Uint8Array(bytes), { mergePages: false });
  return text.join(PDF_SEITENTRENNER);
}
