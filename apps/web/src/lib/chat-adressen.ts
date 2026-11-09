/**
 * Plan 15, Bauteil 8: Adressen aus dem Chat, rein und ohne Datenbank.
 *
 * Fehlt im Lead die Belade- oder Entladeadresse, rechnet die Kalkulation mit der
 * besten Angabe aus dem Chat: zuerst was die KI-Analyse zuletzt herausgezogen hat,
 * sonst eine einfache Erkennung in den eingehenden Kundennachrichten. An den
 * Rechner geht nur „PLZ Ort“ (Google rechnet auch damit), nie eine Straße aus
 * einer Erkennung: das ist eine Schätzung, keine bestätigte Adresse.
 */
import type { ChatAdressen } from "./kalkulation-p15";

/** Fünfstellige PLZ, nicht Teil einer längeren Zahl, nicht von Betrag oder Maß gefolgt. */
const PLZ = /(?<![\d.,])(\d{5})(?![\d.,]?\d)(?!\s*(?:€|eur\b|euro\b|m²|m2\b|qm\b|kg\b|km\b|cm\b|m³|cbm\b|stück\b|stk\b))/giu;

/** Wörter, die nach einer PLZ keinen Ort mehr einleiten. */
const KEIN_ORT = new Set([
  "nach", "und", "in", "im", "von", "bis", "oder", "zum", "zur", "ins", "aus", "ab", "mit", "ohne", "am", "um", "auf", "bei",
  "ist", "sind", "wir", "ich", "es", "das", "die", "der", "den", "dem", "ein", "eine", "einen", "also", "bitte", "danke",
]);

/** PLZ gültig: 01001 bis 99998 (00xxx gibt es nicht). */
function plzGueltig(plz: string): boolean {
  const n = Number(plz);
  return n >= 1001 && n <= 99998;
}

/**
 * Ort hinter einer PLZ: bis zu drei Wörter mit großem Anfangsbuchstaben
 * („Stuttgart“, „Bad Cannstatt“, „Leinfelden-Echterdingen“, „Frankfurt am Main“
 * wird zu „Frankfurt“), endet an Satzzeichen oder einem kleinen Wort.
 */
function ortNach(rest: string): string | null {
  const woerter = rest.replace(/^[\s,]+/, "").split(/\s+/);
  const ort: string[] = [];
  for (const roh of woerter) {
    const ende = /[,.;:!?)]$/.test(roh);
    const w = roh.replace(/[,.;:!?()"„“]+$/g, "").replace(/^[("„“]+/, "");
    if (w === "" || !/^\p{Lu}[\p{L}-]*$/u.test(w) || KEIN_ORT.has(w.toLowerCase())) break;
    ort.push(w);
    if (ende || ort.length >= 3) break;
  }
  return ort.length > 0 ? ort.join(" ") : null;
}

interface Fund {
  plz: string;
  text: string;
  /** Stelle im Text */
  index: number;
}

function plzFunde(text: string): Fund[] {
  const funde: Fund[] = [];
  for (const m of text.matchAll(PLZ)) {
    const plz = m[1];
    if (!plzGueltig(plz) || m.index === undefined) continue;
    const ort = ortNach(text.slice(m.index + plz.length, m.index + plz.length + 60));
    funde.push({ plz, text: ort ? `${plz} ${ort}` : plz, index: m.index });
  }
  return funde;
}

/**
 * „PLZ Ort“ aus einer Adressangabe („Hauptstr. 5, 70372 Stuttgart“ → „70372 Stuttgart“).
 * Ohne PLZ null: ein Ort allein ist für den Rechner zu ungenau.
 */
export function plzOrtAus(text: string | null | undefined): string | null {
  if (typeof text !== "string" || text.trim() === "") return null;
  return plzFunde(text)[0]?.text ?? null;
}

const VON_HINWEIS = /\b(von|aus|ab|abhol\w*|auszug\w*|beladen\w*|beladeadresse|jetzige\w*|aktuelle\w*|alte\w*|derzeit\w*|wohne\w*|momentan)\b[^.\n]{0,40}$/i;
const NACH_HINWEIS = /\b(nach|in die|in den|ziel\w*|neue\w*|einzug\w*|entlade\w*|ziehe\w*|ziehen\w*|umzug nach|hin)\b[^.\n]{0,40}$/i;

/** Seite eines Funds aus dem Text davor (bis zum Satzanfang); null = unklar. */
function seiteVor(text: string, fund: Fund, vorher: Fund | null): "von" | "nach" | null {
  const start = vorher ? vorher.index + vorher.plz.length : 0;
  const davor = text.slice(Math.max(start, fund.index - 60), fund.index);
  const nach = NACH_HINWEIS.exec(davor);
  const von = VON_HINWEIS.exec(davor);
  if (nach && von) return nach.index > von.index ? "nach" : "von";
  if (nach) return "nach";
  if (von) return "von";
  return null;
}

/**
 * Erkennung in den eingehenden Kundennachrichten (älteste zuerst). Je Nachricht:
 * Hinweiswörter vor einer PLZ („von … nach …“, „Abholung“, „neue Wohnung“), sonst
 * bei genau zwei PLZ die erste als Beladen, die zweite als Entladen. Spätere
 * Nachrichten gewinnen (der Kunde korrigiert sich). Eine einzelne PLZ ohne
 * Hinweis zählt nicht.
 */
export function adressenAusNachrichten(texte: readonly string[]): { von: string | null; nach: string | null } {
  let von: string | null = null;
  let nach: string | null = null;
  for (const text of texte) {
    if (typeof text !== "string" || text.trim() === "") continue;
    const funde = plzFunde(text);
    if (funde.length === 0) continue;
    let v: string | null = null;
    let n: string | null = null;
    const ohneSeite: Fund[] = [];
    funde.forEach((f, i) => {
      const seite = seiteVor(text, f, funde[i - 1] ?? null);
      if (seite === "von" && v === null) v = f.text;
      else if (seite === "nach" && n === null) n = f.text;
      else if (seite === null) ohneSeite.push(f);
    });
    // Zwei PLZ ohne Hinweis: Reihenfolge wie im Satz („70372 und 71032“).
    if (v === null && n === null && ohneSeite.length === 2 && ohneSeite[0].plz !== ohneSeite[1].plz) {
      v = ohneSeite[0].text;
      n = ohneSeite[1].text;
    } else if (v !== null && n === null && ohneSeite.length === 1 && ohneSeite[0].text !== v) {
      n = ohneSeite[0].text;
    } else if (n !== null && v === null && ohneSeite.length === 1 && ohneSeite[0].text !== n) {
      v = ohneSeite[0].text;
    }
    if (v !== null) von = v;
    if (n !== null) nach = n;
  }
  return { von, nach };
}

/**
 * Wählt je Seite die Chat-Angabe, nur wo das Lead leer ist: KI vor Erkennung.
 * Das Lead selbst gewinnt immer (dann bleibt die Seite hier null).
 */
export function chatAdressenWaehlen(
  lead: { von: string | null; nach: string | null },
  ki: { von: string | null; nach: string | null } | null,
  erkennung: { von: string | null; nach: string | null } | null
): ChatAdressen {
  const seite = (imLead: string | null, k: string | null | undefined, e: string | null | undefined) => {
    if (imLead) return { wert: null, quelle: null };
    const ausKi = plzOrtAus(k);
    if (ausKi) return { wert: ausKi, quelle: "ki" as const };
    const ausErkennung = plzOrtAus(e);
    if (ausErkennung) return { wert: ausErkennung, quelle: "erkennung" as const };
    return { wert: null, quelle: null };
  };
  const v = seite(lead.von, ki?.von, erkennung?.von);
  const n = seite(lead.nach, ki?.nach, erkennung?.nach);
  return { von: v.wert, nach: n.wert, quelleVon: v.quelle, quelleNach: n.quelle };
}

/** true, wenn eine Seite aus dem Chat kommt. */
export function hatChatAdresse(c: ChatAdressen | null | undefined): boolean {
  return !!c && (c.von !== null || c.nach !== null);
}
