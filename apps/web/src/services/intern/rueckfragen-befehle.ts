/**
 * Rückfragen per WhatsApp: reine Logik ohne Datenbank.
 *
 * Ein Werkzeug außerhalb des CRM (Quelle, zum Beispiel Kassensturz) stellt
 * Fragen an eine interne Nummer. Jede Frage bekommt einen Kurzcode aus vier
 * Zeichen. Die Codes liegen außerhalb der Freigabe-Grammatik (dort sind Codes
 * vier Hex-Zeichen): erstes Zeichen aus G bis Z ohne I und O, die drei
 * weiteren zusätzlich aus den Ziffern 2 bis 9. Ein Rückfrage-Code kann also nie
 * "ok CODE" oder "nein CODE" auslösen.
 *
 * Antwort: Code am Anfang (mit oder ohne #, danach Leerzeichen, Doppelpunkt
 * oder Ende), dann freier Text. Ohne Code gilt die Antwort nur, wenn genau
 * eine Frage offen ist.
 */

const ERSTES = "GHJKLMNPQRSTUVWXYZ";
const WEITERE = "GHJKLMNPQRSTUVWXYZ23456789";
const MAX_VERSUCHE = 200;

export const RUECKFRAGE_CODE_RE = /^#?([G-HJ-NP-Z][G-HJ-NP-Z2-9]{3})\b/i;

export const QUELLEN_LABELS: Record<string, string> = { kassensturz: "Kassensturz" };

export function neuerCode(vergeben: ReadonlySet<string>, random: () => number = Math.random): string {
  const zeichen = (alphabet: string) => alphabet[Math.min(alphabet.length - 1, Math.floor(random() * alphabet.length))]!;
  for (let versuch = 0; versuch < MAX_VERSUCHE; versuch += 1) {
    const code = zeichen(ERSTES) + zeichen(WEITERE) + zeichen(WEITERE) + zeichen(WEITERE);
    if (!vergeben.has(code)) return code;
  }
  throw new Error("kein freier Code für Rückfragen");
}

export type AntwortRoh = { code: string | null; antwort: string };

/**
 * Führender Code, wenn er zu einer offenen oder bekannten (abgelaufenen,
 * beantworteten) Frage gehört. Ein Wort, das nur zufällig im Code-Alphabet
 * steht ("Kurt Meyer"), bleibt Teil der Antwort.
 */
export function antwortAus(text: string, offeneCodes: readonly string[], bekannteCodes: readonly string[] = []): AntwortRoh | null {
  const t = text.trim();
  if (!t) return null;
  const treffer = /^#?([a-z0-9]{4})(?=$|[\s:,.;!?])\s*:?\s*/i.exec(t);
  if (treffer) {
    const code = treffer[1]!.toUpperCase();
    if (offeneCodes.includes(code) || bekannteCodes.includes(code)) return { code, antwort: t.slice(treffer[0].length).trim() };
  }
  return { code: null, antwort: t };
}

export type RueckfrageWahl<T> = { treffer: T } | { fehler: "kein_treffer" | "mehrdeutig" | "keine_offen" };

export function waehleRueckfrage<T extends { id: string; code: string }>(offene: readonly T[], parsed: { code: string | null }): RueckfrageWahl<T> {
  if (parsed.code) {
    const treffer = offene.find((frage) => frage.code === parsed.code);
    return treffer ? { treffer } : { fehler: "kein_treffer" };
  }
  if (offene.length === 0) return { fehler: "keine_offen" };
  if (offene.length > 1) return { fehler: "mehrdeutig" };
  return { treffer: offene[0]! };
}

export function rueckfrageNachricht(quelle: string, fragen: ReadonlyArray<{ code: string; frage: string; optionen: string[] }>): string {
  const name = QUELLEN_LABELS[quelle] ?? quelle;
  const kopf = fragen.length === 1 ? `Rückfrage von ${name}:` : `Rückfragen von ${name} (${fragen.length}):`;
  const absaetze = fragen.map(({ code, frage, optionen }) => {
    const antworten = [...optionen.map((option) => `${code} ${option}`), `${code} <Text>`].join(" / ");
    return `#${code} ${frage}\nAntwort: ${antworten}`;
  });
  return [kopf, ...absaetze].join("\n\n").replace(/[–—]/g, ",");
}

export type RueckfrageAnfrage = {
  quelle: string;
  empfaenger?: string;
  fragen: Array<{ frage: string; optionen: string[]; payload?: Record<string, unknown>; ablaufTage: number }>;
};

const QUELLE_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;
const istObjekt = (wert: unknown): wert is Record<string, unknown> => typeof wert === "object" && wert !== null && !Array.isArray(wert);

export function validiereRueckfragen(body: unknown): { ok: true; value: RueckfrageAnfrage } | { ok: false; fehler: string } {
  if (!istObjekt(body)) return { ok: false, fehler: "Body muss ein Objekt sein" };
  const { quelle, empfaenger, fragen } = body;
  if (typeof quelle !== "string" || !QUELLE_RE.test(quelle)) return { ok: false, fehler: "quelle: Kleinbuchstaben, Ziffern, Bindestrich, höchstens 40 Zeichen" };
  if (empfaenger !== undefined && (typeof empfaenger !== "string" || !empfaenger.trim() || empfaenger.length > 40)) return { ok: false, fehler: "empfaenger: 1 bis 40 Zeichen" };
  if (!Array.isArray(fragen) || fragen.length < 1 || fragen.length > 10) return { ok: false, fehler: "fragen: 1 bis 10 Einträge" };
  const value: RueckfrageAnfrage = { quelle, fragen: [] };
  if (typeof empfaenger === "string") value.empfaenger = empfaenger.trim();
  for (const [index, roh] of fragen.entries()) {
    if (!istObjekt(roh)) return { ok: false, fehler: `fragen.${index}: Objekt erwartet` };
    const { frage, optionen, payload, ablaufTage } = roh;
    if (typeof frage !== "string" || !frage.trim() || frage.length > 500) return { ok: false, fehler: `fragen.${index}.frage: 1 bis 500 Zeichen` };
    const liste = optionen === undefined ? [] : optionen;
    if (!Array.isArray(liste) || liste.length > 8 || liste.some((option) => typeof option !== "string" || !option.trim() || option.length > 40)) {
      return { ok: false, fehler: `fragen.${index}.optionen: höchstens 8 Einträge je 1 bis 40 Zeichen` };
    }
    if (payload !== undefined && !istObjekt(payload)) return { ok: false, fehler: `fragen.${index}.payload: Objekt erwartet` };
    const tage = ablaufTage === undefined ? 7 : ablaufTage;
    if (typeof tage !== "number" || !Number.isInteger(tage) || tage < 1 || tage > 30) return { ok: false, fehler: `fragen.${index}.ablaufTage: ganze Zahl 1 bis 30` };
    const eintrag: RueckfrageAnfrage["fragen"][number] = { frage: frage.trim(), optionen: liste as string[], ablaufTage: tage };
    if (payload !== undefined) eintrag.payload = payload;
    value.fragen.push(eintrag);
  }
  return { ok: true, value };
}

export type AntwortEntscheidung =
  | { aktion: "speichern"; id: string; code: string; antwort: string }
  | { aktion: "melden"; text: string }
  | { aktion: "ignorieren" };

/**
 * Was mit einer Nachricht des Empfängers passiert: speichern, kurz melden
 * oder wie bisher verwerfen. `bekannte` sind Fragen desselben Empfängers, die
 * nicht mehr offen sind (abgelaufen oder beantwortet).
 */
export function antwortEntscheidung(
  text: string,
  offene: ReadonlyArray<{ id: string; code: string }>,
  bekannte: ReadonlyArray<{ code: string; status: string }>
): AntwortEntscheidung {
  const parsed = antwortAus(
    text,
    offene.map((frage) => frage.code),
    bekannte.map((frage) => frage.code)
  );
  if (!parsed) return { aktion: "ignorieren" };
  if (parsed.code && !offene.some((frage) => frage.code === parsed.code)) {
    const alt = bekannte.find((frage) => frage.code === parsed.code);
    if (alt?.status === "beantwortet") return { aktion: "melden", text: `#${parsed.code} ist schon beantwortet.` };
    return { aktion: "melden", text: `#${parsed.code} ist abgelaufen, die Frage kommt bei Bedarf neu.` };
  }
  const wahl = waehleRueckfrage(offene, parsed);
  if ("fehler" in wahl) {
    if (wahl.fehler === "mehrdeutig") return { aktion: "melden", text: `Bitte mit Code antworten (offen: ${offene.map((frage) => frage.code).join(", ")}).` };
    if (wahl.fehler === "kein_treffer") return { aktion: "melden", text: `Keine offene Rückfrage #${parsed.code}.` };
    return { aktion: "ignorieren" };
  }
  if (!parsed.antwort) return { aktion: "melden", text: `Bitte nach dem Code die Antwort schreiben, zum Beispiel: ${wahl.treffer.code} privat` };
  return { aktion: "speichern", id: wahl.treffer.id, code: wahl.treffer.code, antwort: parsed.antwort };
}
