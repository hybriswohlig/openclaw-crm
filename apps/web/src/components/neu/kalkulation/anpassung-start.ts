/**
 * Womit der Anpassungs-Dialog öffnet: eine Kostenzeile, ein Satz, ein
 * Zeitposten, Material, eine Eingabe, die Marge oder die freie Wahl. Aus
 * einer bestehenden Anpassung wird der Start mit ihrem Wert vorbelegt (M6).
 * Rein, ohne React.
 */
import type { AnpassungAnsicht } from "@/lib/kalkulations-ansicht";

export type AnpassungStart =
  | { art: "wahl" }
  | { art: "zeile"; key: string; label: string; aktuell: string | null; betrag?: number }
  | { art: "satz"; key: "arbeit" | "fahrt"; satz?: number }
  | { art: "zeitposten"; key?: string; bezeichnung?: string; minuten?: number }
  | { art: "material_frei"; key?: string; bezeichnung?: string; betrag?: number }
  | { art: "eingabe"; key?: string; wert?: number | string | boolean }
  | { art: "marge"; prozent?: number };

const zahl = (w: AnpassungAnsicht["wert"]): number | undefined => (typeof w === "number" ? w : undefined);

/** Start für eine bestehende Anpassung, mit ihrem Wert vorbelegt. */
export function startFuer(a: AnpassungAnsicht): AnpassungStart {
  const posten = a.wert && typeof a.wert === "object" ? a.wert : null;
  const bezeichnung = posten?.bezeichnung ?? a.text.split(":")[0]?.trim();
  switch (a.art) {
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
  }
}
