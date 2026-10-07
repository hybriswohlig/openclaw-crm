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

/** Nach so vielen Tagen ohne Bearbeitung gilt eine neue Anfrage als veraltet. */
export const NEU_PRUEFEN_TAGE = 7;

const TAG_MS = 24 * 60 * 60 * 1000;

/** Kunde hat zuletzt geschrieben (oder wir haben nie geantwortet). */
function kundeZuletzt(t: ThreadSignal): boolean {
  if (!t.letzteEingehend) return false;
  return !t.letzteAusgehend || t.letzteEingehend.getTime() > t.letzteAusgehend.getTime();
}

/**
 * Warum ein Lead auf uns wartet, nur aus belastbaren Signalen:
 * - antwort: offener WhatsApp-Lead-Thread, Kunde schrieb zuletzt.
 * - neu_pruefen: Status "neu", nie etwas von uns gesendet, jünger als 7 Tage.
 * E-Mail (Antworten laufen über Gmail, im CRM unsichtbar) und SMS lösen nie
 * "wartet" aus; ungelesene E-Mails werden separat gezählt.
 */
export function wartetAuf(input: {
  status: KartenStatus;
  angelegtAm: Date;
  threads: ThreadSignal[];
  jetzt: Date;
}): { wartet: Wartet | null; veraltet: boolean; emailUngelesen: number } {
  const relevant = input.threads.filter((t) => t.lane === "lead" && t.status === "open");

  const emailUngelesen = relevant
    .filter((t) => t.kanal === "email" && kundeZuletzt(t))
    .reduce((summe, t) => summe + t.ungelesen, 0);

  if (input.status === "verloren") return { wartet: null, veraltet: false, emailUngelesen };

  const nieBeantwortet = input.status === "neu" && !input.threads.some((t) => t.letzteAusgehend);
  const imFenster = input.jetzt.getTime() - input.angelegtAm.getTime() <= NEU_PRUEFEN_TAGE * TAG_MS;
  const veraltet = nieBeantwortet && !imFenster;

  let antwort: { seit: Date; chatId: string } | null = null;
  for (const t of relevant) {
    if (t.kanal !== "whatsapp" || !kundeZuletzt(t)) continue;
    const seit = t.ersteEingehendNachAusgehend ?? t.letzteEingehend;
    if (seit && (!antwort || seit.getTime() < antwort.seit.getTime())) {
      antwort = { seit, chatId: t.id };
    }
  }
  if (antwort) {
    return {
      wartet: { art: "antwort", seit: antwort.seit.toISOString(), chatId: antwort.chatId },
      veraltet,
      emailUngelesen,
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
    };
  }

  return { wartet: null, veraltet, emailUngelesen };
}
