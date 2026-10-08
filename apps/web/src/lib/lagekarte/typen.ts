/**
 * Lagekarte: gemeinsame Typen für Server (services/lagekarte) und Client
 * (components/lagekarte). Client-sicher, keine Server-Imports.
 *
 * Geldbeträge sind hier IMMER ganze Cent (number). Umrechnung aus Euro-
 * Spalten passiert ausschließlich in services/lagekarte/wert.ts.
 */

/** Abgeleiteter Kartenstatus, Rangfolge siehe services/lagekarte/status.ts. */
export type KartenStatus =
  | "neu"
  | "kontakt"
  | "angebot"
  | "auftrag"
  | "erledigt"
  | "verloren"
  | "unbekannt";

export const KARTEN_STATUS_REIHENFOLGE: KartenStatus[] = [
  "neu",
  "kontakt",
  "angebot",
  "auftrag",
  "erledigt",
  "verloren",
  "unbekannt",
];

/** Woher die Position stammt (in Prioritätsreihenfolge der Auflösung). */
export type OrtQuelle = "abholadresse" | "freitext" | "immoscout" | "ortsname" | "zieladresse";

/** plz = PLZ-Schwerpunkt, ort = Ortsname-Schwerpunkt. Nie hausgenau. */
export type OrtGenauigkeit = "plz" | "ort";

export interface KartenOrt {
  /** Angezeigte Position (PLZ-Schwerpunkt plus kleiner, deterministischer Versatz). */
  lat: number;
  lng: number;
  plz: string | null;
  /** z. B. "Stuttgart-West" oder "Wildberg" */
  ortsname: string;
  /** Amtlicher Kreisschlüssel (5-stellig, z. B. "08111"), aus der PLZ-Tabelle, nie aus dem Versatz. */
  kreisAgs: string | null;
  genauigkeit: OrtGenauigkeit;
  quelle: OrtQuelle;
}

/**
 * Warum ein Lead auf uns wartet. Nur belastbare Signale:
 * - antwort: offener WhatsApp-Thread, letzte Nachricht kam vom Kunden, und diese
 *   letzte Kundennachricht ist höchstens 14 Tage alt (Ruling 9). Ältere offene
 *   Threads warten nicht, sie stehen in LeadPunkt.alterChat (Mission „chat_aufraeumen“).
 * - neu_pruefen: Status "neu", keine ausgehende Nachricht, jünger als 7 Tage.
 * E-Mail zählt bewusst NICHT (Antworten laufen über Gmail und sind im CRM unsichtbar);
 * ungelesene E-Mails stehen separat in LeadPunkt.emailUngelesen.
 */
export type WarteArt = "antwort" | "neu_pruefen";

export interface Wartet {
  art: WarteArt;
  /** ISO. antwort: erste Kundennachricht nach unserer letzten Antwort. neu_pruefen: Eingang. */
  seit: string;
  /** Thread, der das Warten auslöst (bei antwort immer gesetzt). */
  chatId: string | null;
}

/** bestaetigt = aktive KV-Annahme, angebot = Angebotssumme, schaetzung = Lead-Wert/Rechner. */
export type WertArt = "bestaetigt" | "angebot" | "schaetzung";

export interface LeadWert {
  cent: number;
  art: WertArt;
}

/**
 * Plausibilitätsgrenze je Lead: 50.000 € (größter echter Auftrag rund 5.000 €).
 * Darüber ist es fast sicher ein Tippfehler: nicht in Summen, nicht in
 * Markergröße oder Säulenhöhe, sichtbarer Hinweis im Panel, Mission „Wert prüfen“.
 */
export const WERT_PLAUSIBEL_MAX_CENT = 5_000_000;

/** Wert für Rechnungen und Größen: unplausibel hohe Werte gelten als unbekannt (null). */
export function plausiblerCent(wert: LeadWert | null): number | null {
  if (wert === null || wert.cent > WERT_PLAUSIBEL_MAX_CENT) return null;
  return wert.cent;
}

/** Welches KV-PDF "KV ansehen" öffnet. */
export type KvDokumentStand = "angenommen" | "aktuell" | "veraltet" | "keins";

export interface KvInfo {
  /** Angebot (quotations-Zeile) existiert. Heißt NICHT, dass es versendet wurde. */
  angebotErstellt: boolean;
  angebotErstelltAm: string | null;
  /** Kundenlink existiert und ist nicht widerrufen. */
  linkAktiv: boolean;
  linkErstelltAm: string | null;
  linkAngesehenAnzahl: number;
  linkZuletztAngesehen: string | null;
  /** signed_at der aktiven KV-Annahme. */
  angenommenAm: string | null;
  dokumentId: string | null;
  dokumentStand: KvDokumentStand;
}

export type ChatKanal = "whatsapp" | "email" | "sms";

export interface ChatKurz {
  id: string;
  kanal: ChatKanal;
  /** Name des Kanal-Kontos, z. B. "Kottke WhatsApp". */
  kontoName: string;
  firmaId: string | null;
  status: "open" | "resolved" | "spam";
  letzteNachrichtAm: string | null;
  /** Vorschau der letzten Nachricht ("Du: …" bei ausgehend), max. 140 Zeichen. */
  vorschau: string | null;
  ungelesen: number;
  /** Letzte Nachricht kam vom Kunden (nur für WhatsApp belastbar). */
  kundeZuletzt: boolean;
}

export interface LeadPunkt {
  id: string;
  nummer: string | null;
  name: string;
  /** ISO, records.created_at */
  angelegtAm: string;
  /** YYYY-MM-DD */
  umzugAm: string | null;
  firmaId: string | null;
  stufe: { id: string; titel: string; farbe: string } | null;
  status: KartenStatus;
  /** Widersprüche oder Zusatzinfo, z. B. "KV angenommen, Stufe noch „In Kontakt“". */
  statusHinweis: string | null;
  /** Durchgeführt, aber noch nicht bezahlt. */
  zahlungOffen: boolean;
  /** Abholort (Kartenposition). null = "Ohne Ort". */
  ort: KartenOrt | null;
  /** Zielort (nur Anzeige / A→B). */
  ziel: KartenOrt | null;
  wert: LeadWert | null;
  bezahltCent: number;
  wartet: Wartet | null;
  /** Status neu, älter als 7 Tage, ohne Bearbeitung: gehört in "Stufe pflegen". */
  veraltet: boolean;
  /** Anzahl ungelesener E-Mail-Nachrichten in offenen Lead-Threads (Antwortstatus unbekannt). */
  emailUngelesen: number;
  /**
   * Ältester offener WhatsApp-Thread, in dem der Kunde zuletzt schrieb, aber vor mehr als
   * 14 Tagen (wartet deshalb nicht). seit = erste offene Kundennachricht (ISO). Sonst null.
   */
  alterChat: { chatId: string; seit: string } | null;
  /** Lead-Threads, neueste zuerst; offene vor erledigten. */
  chats: ChatKurz[];
  kv: KvInfo;
  kiEntwurfWartet: boolean;
  telefon: string | null;
}

export interface Firma {
  id: string;
  name: string;
  /** 1 bis 2 Buchstaben für Marker-Badges, z. B. "K". */
  kurz: string;
  /** Hex mit #, z. B. "#1f3a5f". */
  farbe: string;
}

export interface StufeOption {
  id: string;
  titel: string;
  farbe: string;
  kategorie: string | null;
  aktiv: boolean;
  reihenfolge: number;
}

export interface Kennzahlen {
  wartet: {
    gesamt: number;
    antwort: number;
    neuPruefen: number;
    /** ISO des am längsten Wartenden, sonst null. */
    aeltesteSeit: string | null;
  };
  emailUngelesen: { leads: number };
  angeboteOffen: { anzahl: number; ungesehen: number };
  /** Basis: signed_at der aktiven KV-Annahme im laufenden Monat (Europe/Berlin). */
  angenommenMonat: { anzahl: number; cent: number; monat: string };
  /** Umzugstermin heute bis heute+6 (Europe/Berlin), Status auftrag oder erledigt. */
  umzuegeNaechste7Tage: number;
  verortet: { mitOrt: number; gesamt: number };
}

export type MissionArt =
  | "kv_nachfassen"
  | "termin_ohne_auftrag"
  | "auftrag_stufe"
  | "zahlung_offen"
  | "adresse_fehlt"
  | "stufe_pflegen"
  | "wert_pruefen"
  | "chat_aufraeumen";

export interface Mission {
  /** Stabil: `${art}:${leadId}` */
  id: string;
  art: MissionArt;
  titel: string;
  leadId: string;
  /** 1 = dringend, 3 = kann warten */
  dringlichkeit: 1 | 2 | 3;
}

export interface LagekarteAntwort {
  /** ISO-Zeitpunkt der Berechnung */
  stand: string;
  firmen: Firma[];
  stufen: StufeOption[];
  leads: LeadPunkt[];
  kennzahlen: Kennzahlen;
  missionen: Mission[];
}

export interface ChatNachricht {
  id: string;
  richtung: "inbound" | "outbound";
  text: string;
  /** ISO (sent_at, sonst created_at) */
  zeit: string;
  status: string;
}

export interface ChatVorschauAntwort {
  chat: ChatKurz;
  /** Älteste zuerst, max. 20. */
  nachrichten: ChatNachricht[];
  /** Es gibt ältere Nachrichten als die gelieferten. */
  mehr: boolean;
}

/** Meilenstein wie GET /api/v1/deals/{id}/lifecycle (services/deal-lifecycle.ts) ihn liefert. */
export interface VerlaufMeilenstein {
  key: string;
  label: string;
  /** ISO-Zeitstempel oder YYYY-MM-DD, null wenn nicht erreicht. */
  at: string | null;
  done: boolean;
}

export interface VerlaufAntwort {
  milestones: VerlaufMeilenstein[];
  /** Meilenstein, an dem gerade gearbeitet wird (erster nicht erreichter). */
  current: string | null;
}
