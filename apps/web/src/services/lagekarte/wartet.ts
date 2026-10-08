import type { ChatKanal, KartenStatus, Wartet } from "@/lib/lagekarte/typen";

export interface ThreadSignal {
  id: string;
  kanal: ChatKanal;
  status: "open" | "resolved" | "spam";
  lane: string;
  letzteEingehend: Date | null;
  letzteAusgehend: Date | null;
  /** min(sent_at) eingehend nach letzteAusgehend (bzw. erste eingehende überhaupt) */
  ersteEingehendNachAusgehend: Date | null;
  ungelesen: number;
}

/**
 * Ruling 15: Eine ausgehende Nachricht gilt nur als Antwort, wenn sie wirklich
 * rausging. pending (in der Warteschlange) und failed (Zustellung gescheitert)
 * zählen nicht, sonst fällt ein Kunde aus „Wartet“, der nie eine Antwort bekam.
 * laden.ts nutzt dieselbe Liste in SQL.
 */
export const ANTWORT_STATUS = ["sent", "delivered", "read"] as const;

export function zaehltAlsAntwort(m: { direction: "inbound" | "outbound"; status: string }): boolean {
  return m.direction === "outbound" && (ANTWORT_STATUS as readonly string[]).includes(m.status);
}

/**
 * Nachrichten neueste zuerst: Kam nach unserer letzten gesendeten Antwort noch
 * etwas vom Kunden? Ungesendete Nachrichten (pending, failed) werden übersprungen.
 */
export function kundeSchriebZuletzt(
  neuesteZuerst: Array<{ direction: "inbound" | "outbound"; status: string }>,
): boolean {
  const letzte = neuesteZuerst.find((m) => m.direction === "inbound" || zaehltAlsAntwort(m));
  return letzte?.direction === "inbound";
}

/** Nach so vielen Tagen ohne Bearbeitung gilt eine neue Anfrage als veraltet. */
export const NEU_PRUEFEN_TAGE = 7;

/**
 * Ruling 9: Eine offene WhatsApp-Frage wartet nur, solange die LETZTE Kundennachricht
 * höchstens so viele Tage alt ist. Ältere offene Threads sind Aufräumarbeit (alterOffenerChat).
 */
export const ANTWORT_FENSTER_TAGE = 14;

const TAG_MS = 24 * 60 * 60 * 1000;

/**
 * Kunde hat zuletzt geschrieben (oder wir haben nie geantwortet). letzteAusgehend
 * zählt nur gesendete Antworten (sent, delivered, read; laden.ts, Ruling 15).
 */
function kundeZuletzt(t: ThreadSignal): boolean {
  if (!t.letzteEingehend) return false;
  return !t.letzteAusgehend || t.letzteEingehend.getTime() > t.letzteAusgehend.getTime();
}

/**
 * Warum ein Lead auf uns wartet, nur aus belastbaren Signalen:
 * - antwort: offener WhatsApp-Lead-Thread, Kunde schrieb zuletzt, und seine letzte
 *   Nachricht ist höchstens 14 Tage alt (seit = erste offene Kundennachricht).
 * - neu_pruefen: Status "neu", nie etwas von uns gesendet, jünger als 7 Tage.
 * E-Mail (Antworten laufen über Gmail, im CRM unsichtbar) und SMS lösen nie
 * "wartet" aus; ungelesene E-Mails werden separat gezählt.
 *
 * alterOffenerChat: ältester offener WhatsApp-Thread mit Kunde zuletzt, dessen letzte
 * Kundennachricht älter als 14 Tage ist (Mission „chat_aufraeumen“ statt Warten).
 * Bei „verloren“ wartet nie etwas, aber jeder offene WhatsApp-Thread mit Kunde
 * zuletzt ist ein alter Chat, unabhängig vom 14-Tage-Fenster (Grok 4).
 */
export function wartetAuf(input: {
  status: KartenStatus;
  angelegtAm: Date;
  threads: ThreadSignal[];
  jetzt: Date;
}): {
  wartet: Wartet | null;
  veraltet: boolean;
  emailUngelesen: number;
  alterOffenerChat: { chatId: string; seit: string } | null;
} {
  const relevant = input.threads.filter((t) => t.lane === "lead" && t.status === "open");

  const emailUngelesen = relevant
    .filter((t) => t.kanal === "email" && kundeZuletzt(t))
    .reduce((summe, t) => summe + t.ungelesen, 0);

  const verloren = input.status === "verloren";
  const nieBeantwortet = input.status === "neu" && !input.threads.some((t) => t.letzteAusgehend);
  const imFenster = input.jetzt.getTime() - input.angelegtAm.getTime() <= NEU_PRUEFEN_TAGE * TAG_MS;
  const veraltet = nieBeantwortet && !imFenster;

  // Je offener WhatsApp-Frage: frisch (wartet) oder alt (aufräumen); jeweils die älteste gewinnt.
  let antwort: { seit: Date; chatId: string } | null = null;
  let alt: { seit: Date; chatId: string } | null = null;
  for (const t of relevant) {
    if (t.kanal !== "whatsapp" || !kundeZuletzt(t) || !t.letzteEingehend) continue;
    const seit = t.ersteEingehendNachAusgehend ?? t.letzteEingehend;
    const frisch = !verloren && input.jetzt.getTime() - t.letzteEingehend.getTime() <= ANTWORT_FENSTER_TAGE * TAG_MS;
    const bisher = frisch ? antwort : alt;
    if (!bisher || seit.getTime() < bisher.seit.getTime()) {
      if (frisch) antwort = { seit, chatId: t.id };
      else alt = { seit, chatId: t.id };
    }
  }
  const alterOffenerChat = alt ? { chatId: alt.chatId, seit: alt.seit.toISOString() } : null;

  if (verloren) return { wartet: null, veraltet: false, emailUngelesen, alterOffenerChat };

  if (antwort) {
    return {
      wartet: { art: "antwort", seit: antwort.seit.toISOString(), chatId: antwort.chatId },
      veraltet,
      emailUngelesen,
      alterOffenerChat,
    };
  }

  if (nieBeantwortet && imFenster) {
    const aktivitaet = (t: ThreadSignal) =>
      Math.max(t.letzteEingehend?.getTime() ?? 0, t.letzteAusgehend?.getTime() ?? 0);
    const neuester = relevant.reduce<ThreadSignal | null>(
      (best, t) => (!best || aktivitaet(t) > aktivitaet(best) ? t : best),
      null,
    );
    return {
      wartet: { art: "neu_pruefen", seit: input.angelegtAm.toISOString(), chatId: neuester?.id ?? null },
      veraltet: false,
      emailUngelesen,
      alterOffenerChat,
    };
  }

  return { wartet: null, veraltet, emailUngelesen, alterOffenerChat };
}
