/**
 * Text der von Hand ausgelösten Bewertungsanfrage (Plan 3, Task 9).
 *
 * Eigener Text neben den Vorlagen der Engine (templates.ts bleibt unverändert):
 * leistungsbezogen, ohne „heute“ und ohne Bedingung an den Verlauf des
 * Auftrags, mit der STOP-Zeile als letzter Zeile. Keine Gedankenstriche.
 * Reine Logik, kein I/O.
 */

export type ManuellLeistung = "move" | "kitchen_installation" | "clearance" | "clearance_move";
export type ManuellAnrede = "sie" | "du";
export type ManuellMarke = "kottke" | "ceylan";

export const STOP_ZEILE_SIE = "Keine Nachrichten mehr? Antworten Sie mit STOP.";
export const STOP_ZEILE_DU = "Keine Nachrichten mehr? Antworte mit STOP.";

/**
 * Steht in der Vorschau an der Stelle des Links. Der Token entsteht erst beim
 * Senden; dann ersetzt der Dienst den Platzhalter durch `${APP_URL}/r/{token}`.
 * Ein geänderter Text muss ihn darum enthalten.
 */
export const BEWERTUNGSLINK_PLATZHALTER = "[Bewertungslink]";

/** Obergrenze für einen von Hand geänderten Text (WhatsApp erlaubt 4096 Zeichen). */
export const MAX_TEXT_LAENGE = 1500;

const TEAM: Record<ManuellMarke, string> = {
  kottke: "Kottke-Team",
  ceylan: "Ceylan-Team",
};

/** Leistung im Akkusativ mit Possessiv, für „dass wir … übernehmen durften“. */
const LEISTUNG_AKK: Record<ManuellLeistung, Record<ManuellAnrede, string>> = {
  move: { sie: "Ihren Umzug", du: "deinen Umzug" },
  kitchen_installation: { sie: "Ihre Küchenmontage", du: "deine Küchenmontage" },
  clearance: { sie: "Ihre Entrümpelung", du: "deine Entrümpelung" },
  clearance_move: { sie: "Ihre Entrümpelung und Ihren Umzug", du: "deine Entrümpelung und deinen Umzug" },
};

export function renderManuell(e: {
  marke: ManuellMarke;
  vorname: string | null;
  link: string;
  leistung: ManuellLeistung;
  anrede: ManuellAnrede;
}): string {
  const sie = e.anrede === "sie";
  const name = e.vorname?.trim();
  const gruss = name ? `Hallo ${name},` : sie ? "Guten Tag," : "Hallo,";
  const leistung = (LEISTUNG_AKK[e.leistung] ?? LEISTUNG_AKK.move)[e.anrede];
  const team = TEAM[e.marke] ?? TEAM.kottke;

  const zeilen = sie
    ? [
        gruss,
        "",
        `vielen Dank, dass wir ${leistung} übernehmen durften.`,
        "",
        "Wenn Sie einen Moment Zeit haben, freuen wir uns über eine ehrliche Bewertung bei Google. Damit helfen Sie anderen, die gerade eine passende Firma suchen:",
        e.link,
        "",
        "Viele Grüße",
        `Ihr ${team}`,
        "",
        STOP_ZEILE_SIE,
      ]
    : [
        gruss,
        "",
        `vielen Dank, dass wir ${leistung} übernehmen durften.`,
        "",
        "Wenn du einen Moment Zeit hast, freuen wir uns über eine ehrliche Bewertung bei Google. Damit hilfst du anderen, die gerade eine passende Firma suchen:",
        e.link,
        "",
        "Viele Grüße",
        `Dein ${team}`,
        "",
        STOP_ZEILE_DU,
      ];
  return zeilen.join("\n");
}

/** Gleiche Regel wie `textHatStopHinweis` (agent-suppress.ts): das Wort STOP/STOPP. */
function hatStopHinweis(text: string): boolean {
  return /\bstop+\b/i.test(text);
}

/**
 * Prüft einen (geänderten) Text vor dem Senden. Null, wenn er gesendet werden
 * darf; sonst der deutsche Grund. Pflicht: der Link und ein STOP-Hinweis.
 */

export function textFehler(text: string, link: string): string | null {
  if (!text.trim()) return "Der Text ist leer.";
  if (text.length > MAX_TEXT_LAENGE) return `Der Text ist zu lang (höchstens ${MAX_TEXT_LAENGE} Zeichen).`;
  if (!text.includes(link)) return `Der Text muss den Link ${link} enthalten.`;
  if (!hatStopHinweis(text)) return "Der Text muss den STOP-Hinweis enthalten.";
  return null;
}
