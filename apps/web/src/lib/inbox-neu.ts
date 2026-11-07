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
import { kuerzelAus as akteKuerzel, stufenTon, type StufenTon } from "./akte";
import { berlinTag, datumKurz, tagKurz, uhrzeitKurz } from "./anzeige";
import { berlinDateString } from "./berlin-date";

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
  /**
   * Alle Kanäle der Gespräche dieses Eintrags (für den Kanalfilter);
   * Kleinanzeigen-Gespräche zählen als „kleinanzeigen“, nicht als „email“.
   */
  kanaele: (InboxKanal | "kleinanzeigen")[];
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
  /**
   * Zähler über die ungefilterte Menge (Chips zeigen immer den Gesamtstand).
   * Bei `?q=` über die Treffer; die Oberfläche zeigt dann die Chips der
   * letzten Ladung ohne Suche.
   */
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

// ─── Bausteine der Liste (Plan 6, Task A) ─────────────────────────────────────

/**
 * Ein Gespräch, wie `services/inbox-neu.ts` es lädt: Texte schon bereinigt
 * (Kleinanzeigen-Vorschau, Namenszusatz), Zeiten als ISO, Stufen-Kategorie
 * schon abgeleitet. Eingabe für `eintraegeBauen`.
 */
export interface InboxZeile {
  gespraechId: string;
  /** Nicht gelöschter Deal des Gesprächs, sonst null. */
  dealId: string | null;
  kanal: InboxKanal;
  kleinanzeigen: boolean;
  /** Anzeigename der verknüpften Person (CRM), null wenn keine oder leer. */
  personName: string | null;
  /** `inbox_contacts.display_name` ohne „über Kleinanzeigen“. */
  kontaktName: string | null;
  telefon: string | null;
  email: string | null;
  /** `last_message_preview`, Kleinanzeigen-Boilerplate entfernt; „Du: “ noch dran. */
  vorschau: string | null;
  /** `last_message_at` als ISO. */
  zeit: string | null;
  /** Letzte Nachricht aus `inbox_messages` (ohne interne Fotos), null wenn keine. */
  letzteNachricht: { richtung: "inbound" | "outbound"; am: string | null } | null;
  ungelesen: number;
  lane: string;
  /** Zeile aus `deal_workflow_state`, null ohne Deal oder ohne Zeile. */
  wartet: { auf: "uns" | "kunde" | "niemand"; seit: string | null; grund: string | null } | null;
  /** Deal-Stufe mit abgeleiteter Kategorie, null ohne Deal. */
  stufe: { id: string | null; label: string; kategorie: string | null } | null;
  /** Neuester offener KI-Entwurf an diesem Gespräch und seinem Deal. */
  entwurf: { nachfass: boolean; am: string | null } | null;
  firma: { id: string; name: string } | null;
}

/** Endstufen: hier wartet niemand mehr, keine Wartet-Pille. */
const ENDSTUFEN = new Set(["paid", "lost", "kein_lead"]);
const INFO_LANES = new Set(["info", "kein_lead"]);

const TAG_MS = 24 * 60 * 60 * 1000;

function tageZwischen(vonTag: string, bisTag: string): number {
  const [a, b] = [vonTag, bisTag].map((t) => {
    const [j, m, d] = t.split("-").map(Number);
    return Date.UTC(j, m - 1, d);
  });
  return Math.round((b - a) / TAG_MS);
}

/**
 * Zeittext der Liste in Berlin: „09:14“ heute, „gestern“, Wochentag („Di“)
 * in den letzten sechs Tagen, sonst „03.11.“; „“ ohne Zeitpunkt.
 */
export function zeitText(iso: string | null, jetzt: Date): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const tage = tageZwischen(berlinTag(iso), berlinDateString(jetzt));
  if (tage === 0) return uhrzeitKurz(iso);
  if (tage === 1) return "gestern";
  if (tage >= 2 && tage <= 6) return tagKurz(iso).split(" ")[0];
  return datumKurz(iso);
}

/** Initialen für den Avatar: „Familie Öztürk“ → „FÖ“; „?“ ohne Namen. */
export function kuerzelAus(name: string | null | undefined): string {
  return akteKuerzel(name ?? "") || "?";
}

/** Sieht aus wie eine Nummer (dann kein Name). */
function istNummer(text: string): boolean {
  return /^[+\d\s()/.-]+$/.test(text) && /\d/.test(text);
}

/** Unbekannte Nummer gekürzt: „+491701234567“ → „+49 170 …“. */
export function nummerKurz(nummer: string): string {
  const roh = nummer.trim();
  const ziffern = roh.replace(/\D/g, "");
  if (roh.startsWith("+") && ziffern.startsWith("49") && ziffern.length > 5) {
    return `+49 ${ziffern.slice(2, 5)} …`;
  }
  if (roh.startsWith("+") && ziffern.length > 5) return `+${ziffern.slice(0, 2)} ${ziffern.slice(2, 5)} …`;
  if (ziffern.length > 4) return `${ziffern.slice(0, 4)} …`;
  return roh;
}

/** „Du: “ am Anfang der Vorschau wird zum Präfix; eingehende E-Mails bekommen „E-Mail:“. */
export function vorschauTeilen(
  vorschau: string | null,
  richtung: "inbound" | "outbound" | null,
  kanal: InboxKanal,
  kleinanzeigen: boolean,
): { vorschau: string; vorschauPraefix: string | null } {
  const text = (vorschau ?? "").trim();
  const du = /^Du:\s*/.exec(text);
  if (du) return { vorschau: text.slice(du[0].length), vorschauPraefix: "Du:" };
  if (richtung === "outbound") return { vorschau: text, vorschauPraefix: "Du:" };
  if (kanal === "email" && !kleinanzeigen) return { vorschau: text, vorschauPraefix: "E-Mail:" };
  return { vorschau: text, vorschauPraefix: null };
}

function mitDauer(text: string, seit: string | null, jetzt: Date): string {
  return seit ? `${text} · ${wartedauer(seit, jetzt)}` : text;
}

/** Neueste zuerst, ohne Zeitpunkt zuletzt. */
function nachZeitAbsteigend(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  return new Date(b).getTime() - new Date(a).getTime();
}

/** Älteste zuerst, ohne Zeitpunkt zuletzt. */
function nachZeitAufsteigend(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  return new Date(a).getTime() - new Date(b).getTime();
}

function nameAus(gespraeche: InboxZeile[]): { name: string; bekannt: boolean } {
  for (const g of gespraeche) {
    const n = g.personName?.trim();
    if (n) return { name: n, bekannt: true };
  }
  for (const g of gespraeche) {
    const n = g.kontaktName?.trim();
    if (n && !istNummer(n)) return { name: n, bekannt: true };
  }
  for (const g of gespraeche) {
    const nummer = g.telefon?.trim() || (g.kontaktName && istNummer(g.kontaktName) ? g.kontaktName.trim() : "");
    if (nummer) return { name: nummerKurz(nummer), bekannt: false };
  }
  for (const g of gespraeche) {
    const mail = g.email?.trim();
    if (mail) return { name: mail, bekannt: false };
  }
  return { name: "Unbekannt", bekannt: false };
}

/**
 * Wartet-Pille (Entscheidung 4). Deal: aus `deal_workflow_state`; Endstufe
 * ohne Pille; „niemand“ oder keine Zeile bei offener Stufe „läuft“. Ohne Deal:
 * „uns“, wenn die letzte Nachricht eingehend ist, sonst keine Pille. In der
 * Info-Gruppe wartet nie etwas auf uns.
 */
function wartetAus(
  neueste: InboxZeile,
  istDeal: boolean,
  gruppe: InboxGruppe,
  jetzt: Date,
): InboxEintrag["wartet"] {
  const keine: InboxEintrag["wartet"] = { auf: "niemand", seit: null, text: null };
  if (!istDeal) {
    const letzte = neueste.letzteNachricht;
    if (gruppe === "haupt" && letzte?.richtung === "inbound") {
      return { auf: "uns", seit: letzte.am, text: mitDauer("wartet auf uns", letzte.am, jetzt) };
    }
    return keine;
  }
  const kategorie = neueste.stufe?.kategorie ?? null;
  if (kategorie && ENDSTUFEN.has(kategorie)) return keine;
  const w = neueste.wartet;
  const laeuft: InboxEintrag["wartet"] = { auf: "niemand", seit: null, text: "läuft" };
  if (!w || w.auf === "niemand") return laeuft;
  if (w.auf === "uns") {
    if (gruppe === "info") return laeuft;
    // berechneWartet meldet einen KV, der seit über 3 Tagen ungesehen ist, als „uns“
    // (wir sollten nachhaken); die Pille sagt dann wie im Mockup „KV ungesehen“.
    const ungesehen = /ungesehen/i.test(w.grund ?? "");
    return { auf: "uns", seit: w.seit, text: mitDauer(ungesehen ? "KV ungesehen" : "wartet auf uns", w.seit, jetzt) };
  }
  const kvUngesehen = /ungesehen/i.test(w.grund ?? "");
  return {
    auf: "kunde",
    seit: w.seit,
    text: mitDauer(kvUngesehen ? "KV ungesehen" : "wartet auf Kunden", w.seit, jetzt),
  };
}

/**
 * Gespräche zu Einträgen (Entscheidung 1): alle Gespräche eines Deals werden
 * ein Eintrag `deal:{id}`, jedes Gespräch ohne Deal ein Eintrag
 * `gespraech:{id}`. Kanal, Vorschau und Zeit vom Gespräch mit der neuesten
 * Nachricht; Ungelesen summiert. Reihenfolge wie die Eingabe (erstes
 * Auftreten); sortiert wird mit `sortieren`.
 */
export function eintraegeBauen(zeilen: InboxZeile[], jetzt: Date): InboxEintrag[] {
  const gruppen = new Map<string, InboxZeile[]>();
  for (const z of zeilen) {
    const key = z.dealId ? `deal:${z.dealId}` : `gespraech:${z.gespraechId}`;
    const liste = gruppen.get(key);
    if (liste) liste.push(z);
    else gruppen.set(key, [z]);
  }

  const eintraege: InboxEintrag[] = [];
  for (const [key, liste] of gruppen) {
    const gespraeche = [...liste].sort(
      (a, b) => nachZeitAbsteigend(a.zeit, b.zeit) || a.gespraechId.localeCompare(b.gespraechId),
    );
    const neueste = gespraeche[0];
    const dealId = neueste.dealId;
    const gruppe: InboxGruppe = gespraeche.every((g) => INFO_LANES.has(g.lane)) ? "info" : "haupt";
    const { name, bekannt } = nameAus(gespraeche);
    const { vorschau, vorschauPraefix } = vorschauTeilen(
      neueste.vorschau,
      neueste.letzteNachricht?.richtung ?? null,
      neueste.kanal,
      neueste.kleinanzeigen,
    );

    const kanaele: InboxEintrag["kanaele"] = [];
    for (const g of gespraeche) {
      const k = g.kleinanzeigen ? "kleinanzeigen" : g.kanal;
      if (!kanaele.includes(k)) kanaele.push(k);
    }

    const entwuerfe = gespraeche
      .map((g) => g.entwurf)
      .filter((e): e is NonNullable<InboxZeile["entwurf"]> => e !== null)
      .sort((a, b) => nachZeitAbsteigend(a.am, b.am));
    const entwurf = dealId ? entwuerfe[0] ?? null : null;

    eintraege.push({
      key,
      dealId,
      gespraechIds: gespraeche.map((g) => g.gespraechId),
      name,
      kuerzel: bekannt ? kuerzelAus(name) : "?",
      kanal: neueste.kanal,
      kanaele,
      kleinanzeigen: gespraeche.some((g) => g.kleinanzeigen),
      vorschau,
      vorschauPraefix,
      zeit: neueste.zeit,
      zeitText: zeitText(neueste.zeit, jetzt),
      ungelesen: gespraeche.reduce((s, g) => s + Math.max(0, g.ungelesen), 0),
      wartet: wartetAus(neueste, dealId !== null, gruppe, jetzt),
      kiEntwurf: entwurf ? { text: entwurf.nachfass ? "KI-Entwurf · Nachfass" : "KI-Entwurf" } : null,
      stufe:
        dealId && neueste.stufe
          ? { id: neueste.stufe.id, label: neueste.stufe.label, ton: stufenTon(neueste.stufe.kategorie) }
          : null,
      gruppe,
      laneText: gruppe === "info" ? (neueste.lane === "kein_lead" ? "Kein Lead" : "Info") : null,
      firma: neueste.firma,
    });
  }
  return eintraege;
}

/**
 * Sortierung. Standard „neueste“: wie WhatsApp, die neueste Nachricht oben
 * (Hauptgruppe vor Info, ohne Zeit zuletzt); „wartet auf uns“ bleibt als Pille
 * sichtbar. Modus „wartet“ (Chip „Wartet“ oder „Nur wartet auf uns“): in jeder
 * Gruppe zuerst „wartet auf uns“ nach Wartebeginn aufsteigend (längste
 * Wartezeit oben, ohne Beginn ans Ende davon), dann der Rest nach Zeit.
 * Rückmeldung des Inhabers 07.11.: nach Wartezeit sortiert wirkte die Liste
 * wahllos, aktuelle Chats rutschten unter alte wartende Leads.
 * Neues Array, Eingabe bleibt.
 */
export type InboxSortierung = "neueste" | "wartet";

export function sortieren(eintraege: InboxEintrag[], modus: InboxSortierung = "neueste"): InboxEintrag[] {
  const rang = (e: InboxEintrag) =>
    (e.gruppe === "haupt" ? 0 : 2) + (modus === "wartet" && e.wartet.auf !== "uns" ? 1 : 0);
  return [...eintraege].sort((a, b) => {
    const r = rang(a) - rang(b);
    if (r !== 0) return r;
    if (modus === "wartet" && a.wartet.auf === "uns" && b.wartet.auf === "uns") {
      const s = nachZeitAufsteigend(a.wartet.seit, b.wartet.seit);
      if (s !== 0) return s;
    }
    return nachZeitAbsteigend(a.zeit, b.zeit) || a.key.localeCompare(b.key);
  });
}

const CHIP_PASST: Record<Exclude<InboxChip, null>, (e: InboxEintrag) => boolean> = {
  ungelesen: (e) => e.gruppe === "haupt" && e.ungelesen > 0,
  warten: (e) => e.wartet.auf === "uns",
  ki: (e) => e.kiEntwurf !== null,
  info: (e) => e.gruppe === "info",
};

/** Zähler der Chips „Jetzt“; immer über die ungefilterte Menge aufrufen. Zählt Einträge. */
export function chipsZaehlen(eintraege: InboxEintrag[]): InboxChips {
  const zahl = (chip: Exclude<InboxChip, null>) => eintraege.filter(CHIP_PASST[chip]).length;
  return {
    ungelesen: zahl("ungelesen"),
    wartenAufUns: zahl("warten"),
    kiEntwuerfe: zahl("ki"),
    infoKeinLead: zahl("info"),
  };
}

/** Ab so vielen Zeichen sucht der Server; darunter wirkt die Suche nicht. */
export const SUCHE_MIN_ZEICHEN = 2;

/**
 * Clientseitige Filter über die geladene Liste (Entscheidung 7), Reihenfolge
 * bleibt (neueste oben), außer beim Chip „Wartet“ und „Nur wartet auf uns“. Eine aktive Suche (ab 2 Zeichen, Treffer kommen vom Server) hebt den
 * Chip auf; Kanal, Firma, Stufe und „Nur wartet auf uns“ gelten weiter.
 */
export function filtern(eintraege: InboxEintrag[], filter: InboxFilter): InboxEintrag[] {
  const sucht = filter.suche.trim().length >= SUCHE_MIN_ZEICHEN;
  const chip = sucht ? null : filter.chip;
  const gefiltert = eintraege.filter(
    (e) =>
      (!chip || CHIP_PASST[chip](e)) &&
      (!filter.kanal || e.kanaele.includes(filter.kanal)) &&
      (!filter.firmaId || e.firma?.id === filter.firmaId) &&
      (!filter.stufeId || e.stufe?.id === filter.stufeId) &&
      (!filter.nurWartet || e.wartet.auf === "uns"),
  );
  // Wer gezielt die Wartenden ansieht, bekommt die längste Wartezeit oben.
  return chip === "warten" || filter.nurWartet ? sortieren(gefiltert, "wartet") : gefiltert;
}
