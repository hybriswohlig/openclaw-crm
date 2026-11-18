/**
 * Reine Logik des KI-Chats im KV-Editor (Spec 8, 10; Plan 6a): Auswahl der Vorschläge,
 * Eingabe fürs Übernehmen mit `kiNachrichtId`, Texte der Ablehnungen und Fehler.
 */
import {
  KV_EDITOR_TEXT,
  KV_KI_LEER_TEXT,
  type KiAntwort,
  type KvChatBeitrag,
  type KvKiAblehnung,
  type StandAnlegenEingabe,
} from "@/lib/kv-editor";

/**
 * Ein Beitrag im Chatfenster. `nachrichtId` haben nur KI-Antworten aus dieser Sitzung
 * (`KiAntwort`); der Verlauf (`KvChatBeitrag`) trägt sie im Vertrag nicht, dort sind
 * Vorschläge nur lesend (Abweichung an den Koordinator gemeldet).
 */
export type ChatEintrag = KvChatBeitrag & {
  nachrichtId?: string;
  uebernommen?: boolean;
  /** Welche Vorschläge beim Übernehmen angehakt waren (nur in dieser Sitzung bekannt). */
  uebernommeneSchluessel?: string[];
};

/** Neue Vorschläge kommen alle angehakt. */
export function startAuswahl(vorschlaege: KiAntwort["vorschlaege"]): Set<string> {
  return new Set(vorschlaege.map((v) => v.schluessel));
}

/** Übernehmen (n): nur die angehakten Vorschläge, Vorgänger ist der Stand des Chats. */
export function uebernehmenEingabe(e: ChatEintrag, auswahl: ReadonlySet<string>): StandAnlegenEingabe | null {
  if (!e.nachrichtId || !e.vorschlaege) return null;
  const setzen = e.vorschlaege.filter((v) => auswahl.has(v.schluessel)).map((v) => ({ schluessel: v.schluessel, wert: v.wert }));
  if (setzen.length === 0) return null;
  return { vorgaengerId: e.standId, setzen, zuruecksetzen: [], kiNachrichtId: e.nachrichtId };
}

/** Kann diese Karte noch übernommen werden? Nur mit ID, nicht schon übernommen, mit Vorschlägen. */
export function uebernehmbar(e: ChatEintrag): boolean {
  return e.rolle === "ki" && !!e.nachrichtId && !e.uebernommen && (e.vorschlaege?.length ?? 0) > 0;
}

/** Text einer Ablehnung der KI; `LEER` heißt: nichts Gültiges dabei. */
export function ablehnungText(grund: KvKiAblehnung): string {
  return grund === "LEER" ? KV_KI_LEER_TEXT : KV_EDITOR_TEXT[grund];
}

/** Ablehnungen zusammengefasst je Grund: „Preisangaben … (2)“. */
export function ablehnungZeilen(abgelehnt: KiAntwort["abgelehnt"]): string[] {
  const zaehler = new Map<string, number>();
  for (const a of abgelehnt) {
    const t = ablehnungText(a.grund);
    zaehler.set(t, (zaehler.get(t) ?? 0) + 1);
  }
  return [...zaehler].map(([t, n]) => (n > 1 ? `${t} (${n})` : t));
}

/** KI-Antwort aus dieser Sitzung als Chat-Eintrag. */
export function antwortAlsEintrag(a: KiAntwort, standId: string, am: string): ChatEintrag {
  return { rolle: "ki", text: a.antwort, am, von: null, standId, vorschlaege: a.vorschlaege, abgelehnt: a.abgelehnt, nachrichtId: a.nachrichtId };
}

/** Der Text der Eingabe ist sendbar (nicht leer, höchstens 2000 Zeichen). */
export const KV_CHAT_MAX = 2000;
export function sendbar(text: string): boolean {
  const t = text.trim();
  return t.length > 0 && t.length <= KV_CHAT_MAX;
}
