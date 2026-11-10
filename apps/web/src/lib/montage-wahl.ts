/**
 * Wahl „wer baut ab, wer baut auf“ je Möbel im Inventar der Kalkulation
 * (Inhaber-Wunsch 10.11.). Rein: Startwerte aus der Inventarliste, Schnellwahl,
 * Übersteuerung `montage` und optionale Lead-Änderungen daraus bilden.
 */
import type { InventarListeZeile } from "./kalkulation-inventar";
import type { MontageTraeger, MontageWert } from "./kalkulation-versionen";

export type Wer = "wir" | "kunde" | "nicht_noetig";
export type MontageWahl = Record<string, { abbau: Wer; aufbau: Wer }>;

export const WER_LABEL: Record<Wer, string> = { wir: "wir", kunde: "Kunde", nicht_noetig: "nicht nötig" };
export const MONTAGE_GRUND = "Demontage/Montage je Möbel im Inventar gewählt";

const TRAEGER: Record<Wer, MontageTraeger> = { wir: "company", kunde: "customer", nicht_noetig: "none" };

/** Zeilen, für die man wählen kann: mitgenommen und vom Rechner gerechnet. */
export function waehlbar(zeilen: readonly InventarListeZeile[]): InventarListeZeile[] {
  return zeilen.filter((z) => z.mitnehmen && z.katalog !== null);
}

/** Zeilen, die gerade Demontage oder Montage haben oder schon eine Wahl tragen. */
export function relevant(z: InventarListeZeile): boolean {
  return z.demontage.wer !== "nicht_noetig" || z.montage.wer !== "nicht_noetig" || z.montageGewaehlt;
}

/** Vorbelegung: was die Kalkulation gerade annimmt (Wahl, Lead-Angabe, sonst Rechner-Regel). */
export function startWahl(zeilen: readonly InventarListeZeile[]): MontageWahl {
  const w: MontageWahl = {};
  for (const z of waehlbar(zeilen)) w[z.key] ??= { abbau: z.demontage.wer, aufbau: z.montage.wer };
  return w;
}

/** Schnellwahl: beide Seiten der genannten Möbel auf `wer`. */
export function alleAuf(w: MontageWahl, keys: readonly string[], wer: Wer): MontageWahl {
  const neu = { ...w };
  for (const k of keys) neu[k] = { abbau: wer, aufbau: wer };
  return neu;
}

function geaendert(start: MontageWahl, w: MontageWahl, k: string): boolean {
  return start[k]?.abbau !== w[k]?.abbau || start[k]?.aufbau !== w[k]?.aufbau;
}

/** Schlüssel der Möbel, deren Wahl sich gegenüber dem Start geändert hat. */
export function geaenderteKeys(start: MontageWahl, w: MontageWahl): string[] {
  return Object.keys(w).filter((k) => geaendert(start, w, k));
}

/**
 * Wert der Übersteuerung `montage`: die geänderten Möbel und alle, die schon eine
 * Wahl tragen (die letzte Übersteuerung ersetzt die ganze Liste). null: nichts geändert.
 */
export function montageWert(zeilen: readonly InventarListeZeile[], start: MontageWahl, w: MontageWahl): MontageWert | null {
  const neu = new Set(geaenderteKeys(start, w));
  if (neu.size === 0) return null;
  const positionen: MontageWert["positionen"] = {};
  for (const z of waehlbar(zeilen)) {
    if (!neu.has(z.key) && !z.montageGewaehlt) continue;
    const x = w[z.key];
    if (x) positionen[z.key] = { abbau: TRAEGER[x.abbau], aufbau: TRAEGER[x.aufbau] };
  }
  return { positionen };
}

/** Lead-Änderungen (PATCH …/inventory/:id) für die geänderten Möbel mit Inventarzeile. */
export function leadAenderungen(
  zeilen: readonly InventarListeZeile[],
  start: MontageWahl,
  w: MontageWahl
): Array<{ id: string; dismantlingOwner: MontageTraeger; assemblyOwner: MontageTraeger }> {
  const neu = new Set(geaenderteKeys(start, w));
  return waehlbar(zeilen)
    .filter((z) => z.id && neu.has(z.key))
    .map((z) => ({ id: z.id!, dismantlingOwner: TRAEGER[w[z.key].abbau], assemblyOwner: TRAEGER[w[z.key].aufbau] }));
}
