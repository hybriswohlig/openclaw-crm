/**
 * Womit der Anpassungs-Dialog öffnet: eine Kostenzeile, ein Satz, ein
 * Zeitposten, Material, eine Eingabe, die Marge oder die freie Wahl. Aus
 * einer bestehenden Anpassung wird der Start mit ihrem Wert vorbelegt (M6).
 * Rein, ohne React.
 */
import type { NeueUebersteuerungsArt } from "@/lib/angebot-wahl";
import type { AnpassungAnsicht } from "@/lib/kalkulations-ansicht";
import type { UebersteuerungsArt } from "@/lib/kalkulation-versionen";
import type { PreisStart, TerminStart } from "./preis-logik";

export type AnpassungStart =
  | { art: "wahl" }
  | { art: "zeile"; key: string; label: string; aktuell: string | null; betrag?: number }
  | { art: "satz"; key: "arbeit" | "fahrt"; satz?: number }
  | { art: "zeitposten"; key?: string; bezeichnung?: string; minuten?: number }
  | { art: "material_frei"; key?: string; bezeichnung?: string; betrag?: number }
  | { art: "eingabe"; key?: string; wert?: number | string | boolean }
  | { art: "marge"; prozent?: number };

const zahl = (w: AnpassungAnsicht["wert"]): number | undefined => (typeof w === "number" ? w : undefined);

/** Plan 5b: Anpassungen von Paketpreis, Preismodus und KV-Darstellung öffnen den Preis-Dialog. */
export function istPreisStart(s: AnpassungStart | PreisStart | TerminStart): s is PreisStart {
  return s.art === "paketpreis" || s.art === "preismodus" || s.art === "kv_darstellung";
}

/** Start für eine bestehende Anpassung, mit ihrem Wert vorbelegt. */
export function startFuer(a: AnpassungAnsicht): AnpassungStart | PreisStart | TerminStart {
  const posten = a.wert && typeof a.wert === "object" ? a.wert : null;
  const bezeichnung = posten?.bezeichnung ?? a.text.split(":")[0]?.trim();
  const art = a.art as UebersteuerungsArt | NeueUebersteuerungsArt;
  switch (art) {
    case "paketpreis": {
      const b = (posten as { betrag?: unknown } | null)?.betrag;
      return { art: "paketpreis", slug: a.key, betrag: typeof b === "number" ? b : undefined };
    }
    case "preismodus":
      return { art: "preismodus", modus: a.wert === "stunden" ? "stunden" : a.wert === "fest" ? "fest" : undefined };
    case "kv_darstellung":
      return { art: "kv_darstellung", wert: a.wert === "ein_posten" ? "ein_posten" : a.wert === "posten" ? "posten" : undefined };
    // Tagespreise ändert der Termin-Dialog (Task U2).
    case "tagespreis":
      return { art: "termin" };
    case "marge":
      return { art: "marge", prozent: zahl(a.wert) };
    case "satz":
      return { art: "satz", key: a.key === "fahrt" ? "fahrt" : "arbeit", satz: zahl(a.wert) };
    case "zeitposten":
      return { art: "zeitposten", key: a.key, bezeichnung, minuten: posten?.minuten };
    case "material_frei":
      return { art: "material_frei", key: a.key, bezeichnung, betrag: posten?.betrag };
    case "eingabe":
      return {
        art: "eingabe",
        key: a.key,
        wert: typeof a.wert === "number" || typeof a.wert === "string" || typeof a.wert === "boolean" ? a.wert : undefined,
      };
    case "zeile":
      return { art: "zeile", key: a.key, label: a.text.split(":")[0]?.trim() || a.key, aktuell: null, betrag: zahl(a.wert) };
    default:
      return { art: "wahl" };
  }
}
