/**
 * Vertrag der neuen Inbox (Plan 6): Typen für Liste, Chips, Filter und die
 * Deal-Kurzfassung rechts. Reine Typen und reine Funktionen, ohne Server-
 * Importe: die Oberfläche importiert diese Datei. Laden: `services/inbox-neu.ts`
 * (Liste) und `services/kurzfassung.ts` (rechte Spalte).
 *
 * Ein Listeneintrag ist ein Deal (alle Gespräche, die direkt an ihm hängen,
 * zusammen) oder ein einzelnes Gespräch ohne Deal. Anzeige deutsch,
 * Europe/Berlin, Trenner „·“, keine Gedankenstriche.
 */
import type { StufenTon } from "./akte";

export type InboxKanal = "whatsapp" | "email" | "sms";

/** Gruppe in der Liste: Hauptliste oder eingeklappte Gruppe „Info und Kein Lead“ unten. */
export type InboxGruppe = "haupt" | "info";

export interface InboxEintrag {
  /** `deal:{dealId}` oder `gespraech:{conversationId}`; stabil, auch in der URL (`?e=`). */
  key: string;
  dealId: string | null;
  /** Alle Gespräche dieses Eintrags (bei Deal: direkt verknüpfte), neuestes zuerst. */
  gespraechIds: string[];
  /** Person bzw. Kontakt; unbekannte Nummer gekürzt („+49 170 …“). */
  name: string;
  /** Initialen für den Avatar, „?“ bei unbekanntem Kontakt. */
  kuerzel: string;
  /** Kanal der letzten Nachricht (Kanalpunkt am Avatar). */
  kanal: InboxKanal;
  /** Über Kleinanzeigen gekommen (Quelle, kein eigener Kanal). */
  kleinanzeigen: boolean;
  /** Vorschau der letzten Nachricht, ohne Kleinanzeigen-Boilerplate; Präfix getrennt. */
  vorschau: string;
  /** „E-Mail:“, „Du:“ oder null; wird fett vor die Vorschau gesetzt. */
  vorschauPraefix: string | null;
  /** ISO-Zeitpunkt der letzten Nachricht, null wenn keine. */
  zeit: string | null;
  /** Fertiger Zeittext: „09:14“ heute, „gestern“, „Di“ (diese Woche), „03.11.“ sonst. */
  zeitText: string;
  /** Summe der ungelesenen Nachrichten aller Gespräche des Eintrags. */
  ungelesen: number;
  wartet: {
    auf: "uns" | "kunde" | "niemand";
    /** ISO, seit wann; null wenn unbekannt. */
    seit: string | null;
    /** Pillentext: „wartet auf uns · 35 Min“, „wartet auf Kunden · 2 Tage“, „KV ungesehen · 4 Tage“, „läuft“; null = keine Pille. */
    text: string | null;
  };
  /** Offener KI-Entwurf am Deal; Pillentext „KI-Entwurf“ oder „KI-Entwurf · Nachfass“. */
  kiEntwurf: { text: string } | null;
  /** Deal-Stufe (die eine Stufe), null ohne Deal. */
  stufe: { id: string | null; label: string; ton: StufenTon } | null;
  gruppe: InboxGruppe;
  /** Lane-Text für Einträge der Info-Gruppe: „Info“ oder „Kein Lead“; sonst null. */
  laneText: string | null;
  /** Betriebsfirma über das Kanalkonto; null wenn das Konto keine hat. */
  firma: { id: string; name: string } | null;
}

export interface InboxChips {
  ungelesen: number;
  wartenAufUns: number;
  kiEntwuerfe: number;
  infoKeinLead: number;
}

/** Aktiver Chip „Jetzt“ (Einfachauswahl, zugleich Filter); null = keiner. */
export type InboxChip = "ungelesen" | "warten" | "ki" | "info" | null;

export interface InboxFilter {
  chip: InboxChip;
  kanal: InboxKanal | "kleinanzeigen" | null;
  firmaId: string | null;
  stufeId: string | null;
  nurWartet: boolean;
  /** Freitext; ab 2 Zeichen sucht der Server (Name, Nummer, E-Mail, Betreff, Nachrichtentext). */
  suche: string;
}

export interface InboxListe {
  eintraege: InboxEintrag[];
  /** Zähler über die ungefilterte Menge (Chips zeigen immer den Gesamtstand). */
  chips: InboxChips;
  firmen: { id: string; name: string }[];
  stufen: { id: string; label: string }[];
  /** true, wenn die Server-Obergrenze (500 Gespräche) erreicht wurde. */
  abgeschnitten: boolean;
}

/** Rechte Spalte „Deal · Kurzfassung der Akte“. Alle Werte fertig formatiert, „–“ wenn leer. */
export interface Kurzfassung {
  dealId: string;
  name: string;
  stufe: { id: string | null; label: string; ton: StufenTon };
  zeilen: {
    /** „Kostenvoranschlag“, „Umzugsdatum“ bzw. „Termin“, „Volumen“, „Marge“, „Wartet“ */
    label: string;
    wert: string;
    /** gold bei „Wartet auf uns“, sonst null */
    ton: "gold" | null;
  }[];
  /** „Nächster Schritt: {titel}“ mit Zusatz, null wenn alles erledigt. */
  naechsterSchritt: { titel: string; zusatz: string | null } | null;
  kunde: {
    telefon: string | null;
    email: string | null;
    von: string | null;
    nach: string | null;
    quelle: string | null;
    firma: string | null;
  };
  gespraech: {
    /** „WhatsApp, 2 Anrufe“ */
    kanaele: string;
    fotos: number;
    /** „KV v1, v2 · AB“ oder „–“ */
    dokumente: string;
  };
  nachfass: { an: boolean; modus: "aus" | "sendet" | "entwurf" | "beendet"; text: string };
  /** Stufe mit Kategorie `kein_lead`, für den Knopf „Kein Lead“; null wenn es keine gibt. */
  keinLeadStufeId: string | null;
  /** Stufen-Kategorie des Deals; „Kein Lead“ ist bei booked/done_unpaid/paid gesperrt. */
  kategorie: string | null;
  akteLink: string;
}

/** Wartedauer kurz: „35 Min“, „3 Std“, „1 Tag“, „2 Tage“. */
export function wartedauer(seitIso: string, jetzt: Date): string {
  const min = Math.max(0, Math.floor((jetzt.getTime() - new Date(seitIso).getTime()) / 60_000));
  if (min < 60) return `${Math.max(1, min)} Min`;
  const std = Math.floor(min / 60);
  if (std < 24) return `${std} Std`;
  const tage = Math.floor(std / 24);
  return tage === 1 ? "1 Tag" : `${tage} Tage`;
}
