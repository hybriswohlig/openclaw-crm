/**
 * KI-Wächter: meldet per WhatsApp an die internen Nummern, wenn die KI-Jobs
 * (ai_task_runs) ausfallen, erinnert alle 6 Stunden und gibt Entwarnung.
 * Anlass: crm-tools war im September zwei Wochen zu ~90 % ausgefallen, ohne
 * dass es jemand bemerkt hat. Reine Bewertung hier, Lauf in ki-waechter-lauf.ts.
 *
 * Nachrichten, die nachts entstehen oder einen Empfänger nicht erreichen,
 * liegen in `nachholen` und gehen beim nächsten Lauf in der Sendezeit raus.
 */
export interface WaechterStatus {
  zustand: "ok" | "gestoert";
  /** ISO-Zeitpunkt des letzten Zustandswechsels */
  seit: string;
  letzterAlarm: string | null;
  /** Noch zuzustellende Nachricht und an wen (Namen aus intern_whatsapp_nummern) */
  nachholen: { text: string; an: string[] } | null;
}

export interface KiLage {
  stunde: { laeufe: number; fehler: number };
  dreiStunden: { laeufe: number; erfolge: number };
  haeufigsterFehler: string | null;
}

export const WAECHTER_REGELN = {
  mindestLaeufe: 5,
  fehlerQuote: 0.5,
  erholtQuote: 0.2,
  mindestLaeufeErholt: 3,
  erinnernNachMs: 6 * 60 * 60_000,
  /** Berliner Stunden, in denen gesendet wird: 7 bis 21 Uhr einschließlich */
  sendeVon: 7,
  sendeBis: 22,
} as const;

function zeitText(iso: string): string {
  return new Date(iso).toLocaleString("de-DE", { timeZone: "Europe/Berlin", dateStyle: "short", timeStyle: "short" });
}

export function bewerteKiLage(
  lage: KiLage,
  status: WaechterStatus,
  jetzt: Date,
  berlinStunde: number,
  alleNamen: readonly string[]
): { neuerStatus: WaechterStatus; senden: { text: string; an: string[] } | null } {
  const R = WAECHTER_REGELN;
  const { laeufe, fehler } = lage.stunde;
  const gestoert =
    (laeufe >= R.mindestLaeufe && fehler / laeufe >= R.fehlerQuote) ||
    (lage.dreiStunden.laeufe >= 3 && lage.dreiStunden.erfolge === 0);
  const erholt = laeufe >= R.mindestLaeufeErholt && fehler / laeufe < R.erholtQuote;
  const fehlerZeile = lage.haeufigsterFehler ? `\nHäufigster Fehler: ${lage.haeufigsterFehler.slice(0, 140)}` : "";
  const quote = `${fehler} von ${laeufe} KI-Jobs in der letzten Stunde fehlgeschlagen`;
  const iso = jetzt.toISOString();

  let neu: WaechterStatus = { ...status, nachholen: status.nachholen ?? null };
  let nachricht: string | null = null;

  if (status.zustand === "ok" && gestoert) {
    neu = { ...neu, zustand: "gestoert", seit: iso, letzterAlarm: iso };
    nachricht = `⚠️ KI-Alarm CRM (${zeitText(iso)}): ${quote}.${fehlerZeile}\nBetroffen: Lead-Auswertung, Inventarlisten, Entwürfe. Server crm-tools prüfen (Login Claude/Grok).`;
  } else if (status.zustand === "gestoert" && gestoert) {
    const seitAlarm = status.letzterAlarm ? jetzt.getTime() - new Date(status.letzterAlarm).getTime() : Infinity;
    if (seitAlarm >= R.erinnernNachMs) {
      neu = { ...neu, letzterAlarm: iso };
      nachricht = `⚠️ KI-Störung hält an (seit ${zeitText(status.seit)}): ${quote}.${fehlerZeile}`;
    }
  } else if (status.zustand === "gestoert" && erholt) {
    neu = { ...neu, zustand: "ok", seit: iso };
    nachricht = `✅ KI-Jobs laufen wieder: ${laeufe - fehler} von ${laeufe} erfolgreich in der letzten Stunde.`;
  } else if (status.zustand === "gestoert" && !gestoert && laeufe === 0) {
    // Leerlauf (keine Läufe in der letzten Stunde): still zurücksetzen, damit ein
    // neuer Ausfall wieder als Alarm gemeldet wird. Bei Läufen mit einer Quote
    // zwischen Erholung und Alarmgrenze bleibt die Störung stehen.
    neu = { ...neu, zustand: "ok", seit: iso };
  }

  if (nachricht) {
    // Neue Nachricht an alle; eine noch offene hängt davor, damit nichts verloren geht.
    neu.nachholen = { text: neu.nachholen ? `${neu.nachholen.text}\n\n${nachricht}` : nachricht, an: [...alleNamen] };
  }

  const nacht = berlinStunde < R.sendeVon || berlinStunde >= R.sendeBis;
  return { neuerStatus: neu, senden: !nacht && neu.nachholen && neu.nachholen.an.length > 0 ? neu.nachholen : null };
}
