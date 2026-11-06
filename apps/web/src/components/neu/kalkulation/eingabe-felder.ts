/**
 * Felder des Eingabe-Dialogs (Grundlage): Anzeigetext je Feld, und aus den
 * Eingaben die Liste der geänderten Felder mit geprüftem Wert. Die Prüfung
 * ist dieselbe wie auf dem Server (`pruefeUebersteuerung`), damit bei
 * mehreren Feldern nichts halb gespeichert wird (M5). Ein leeres Feld, das
 * vorher keinen Wert hatte, zählt als unverändert (I1). Rein, ohne React.
 */
import { pruefeUebersteuerung, UebersteuerungFehler, type GrundlageKey } from "@/lib/kalkulation-versionen";
import type { GrundlageFeld } from "@/lib/kalkulations-ansicht";

export interface FeldEingaben {
  /** Text je Feld (zahl, ganzzahl, aufzug, datum) */
  texte: Record<string, string>;
  /** Schalter je Feld (ja_nein) */
  schalter: Record<string, boolean>;
}

export interface GeaendertesFeld {
  key: GrundlageKey;
  wert: number | string | boolean;
}

export type FelderErgebnis = { ok: true; liste: GeaendertesFeld[] } | { ok: false; meldung: string };

/** Anzeigewert eines Felds als Text fürs Formular („2“, „keiner“, „2026-11-21“; leer ohne Wert). */
export function textAus(f: Pick<GrundlageFeld, "typ" | "wert">): string {
  const w = f.wert;
  if (w === null || w === undefined) return f.typ === "aufzug" ? "keiner" : "";
  if (typeof w === "number") return String(w).replace(".", ",");
  if (typeof w === "boolean") return w ? "ja" : "nein";
  return String(w);
}

/** Ausgangszustand der Eingaben aus den Feldern der Zeile. */
export function eingabenAus(felder: GrundlageFeld[]): FeldEingaben {
  return {
    texte: Object.fromEntries(felder.map((f) => [f.key, textAus(f)])),
    schalter: Object.fromEntries(felder.map((f) => [f.key, f.wert === true])),
  };
}

function zahlAus(text: string): number | null {
  const n = Number(text.trim().replace(",", "."));
  return text.trim() === "" || !Number.isFinite(n) ? null : n;
}

/**
 * Geänderte Felder mit geprüftem Wert. Leer bei „nichts geändert“. Die erste
 * Verletzung der Serverregeln (Etage −5 bis 60, Team 1 bis 20, Volumen > 0,
 * Tragweg und Kartons ≥ 0, Datum) kommt als Meldung mit dem Feldnamen zurück,
 * bevor irgendetwas gesendet wird.
 */
export function geaenderteFelder(felder: GrundlageFeld[], eingaben: FeldEingaben, grund: string): FelderErgebnis {
  if (grund.trim() === "") return { ok: false, meldung: "Bitte einen Grund angeben." };
  const liste: GeaendertesFeld[] = [];
  for (const f of felder) {
    let neu: number | string | boolean;
    switch (f.typ) {
      case "ja_nein": {
        neu = eingaben.schalter[f.key] ?? false;
        if ((f.wert === true) === neu) continue;
        break;
      }
      case "aufzug": {
        neu = (eingaben.texte[f.key] ?? "").trim() || "keiner";
        if ((f.wert ?? "keiner") === neu) continue;
        break;
      }
      case "datum": {
        const text = (eingaben.texte[f.key] ?? "").trim();
        if (text === "" && (f.wert === null || f.wert === undefined)) continue;
        if (text === "") return { ok: false, meldung: `${f.label}: bitte ein Datum wählen.` };
        if (text === f.wert) continue;
        neu = text;
        break;
      }
      case "zahl":
      case "ganzzahl": {
        const text = (eingaben.texte[f.key] ?? "").trim();
        if (text === "" && (f.wert === null || f.wert === undefined)) continue;
        const n = zahlAus(text);
        if (n === null) return { ok: false, meldung: `${f.label}: bitte eine ${f.typ === "ganzzahl" ? "ganze " : ""}Zahl eingeben.` };
        if (typeof f.wert === "number" && f.wert === n) continue;
        neu = n;
        break;
      }
    }
    try {
      const geprueft = pruefeUebersteuerung({ art: "eingabe", key: f.key, wert: neu, grund });
      if (geprueft.wert === null || typeof geprueft.wert === "object") continue;
      liste.push({ key: f.key, wert: geprueft.wert });
    } catch (err) {
      if (err instanceof UebersteuerungFehler) return { ok: false, meldung: `${f.label}: ${err.message}.` };
      throw err;
    }
  }
  return { ok: true, liste };
}
