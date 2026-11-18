/**
 * Vertrag KV-Editor (Spec `.superpowers/kv-editor/2026-11-18-kv-editor-design.md`, Plan Aufgabe 0).
 *
 * Gemeinsame Grundlage für alle Teilaufgaben: Typen, Schlüssel-Schema, Felderliste,
 * Konstanten, Texte und die Signaturen der Kernfunktionen als Typen. Rein: keine
 * Datenbank, kein Netz, nur Typ-Importe. Darf von Server und Oberfläche geladen werden.
 *
 * Änderungen hier nur durch den Koordinator (Teilzweige bauen parallel dagegen).
 */
import type { QuotationDocumentDetails } from "@/db/schema/quotations";
import type { DocumentModel, RenderInput } from "@openclaw-crm/document-templates";

// ════════════════════════════════════════════════════════════════════════
// Grundtypen (Spec 5.2)
// ════════════════════════════════════════════════════════════════════════

export const KV_RENDERER = ["vps", "crm"] as const;
export type KvRenderer = (typeof KV_RENDERER)[number];

/** Zuständigkeit wie `QuotationDocumentDetails.services[].owner`. */
export const KV_ZUSTAENDIG = ["company", "customer", "none"] as const;
export type Zustaendig = (typeof KV_ZUSTAENDIG)[number];

/** Text, Zuständigkeit (`Zustaendig` als Text) oder `zeigen` (boolean). */
export type KvWert = string | boolean;

/** Abschnitte in der Reihenfolge des KV (Formular, Verlauf, KI-Katalog). */
export const KV_ABSCHNITTE = [
  "anschreiben",
  "uebersicht",
  "leistungen",
  "umzugsgut",
  "bilder",
  "vereinbarungen",
  "kueche",
  "bemerkungen",
] as const;
export type KvAbschnitt = (typeof KV_ABSCHNITTE)[number];

/** Überschriften der Abschnitte im Formular. */
export const KV_ABSCHNITT_TITEL: Record<KvAbschnitt, string> = {
  anschreiben: "Anschreiben",
  uebersicht: "Projektübersicht",
  leistungen: "Unsere Leistungen",
  umzugsgut: "Umzugsgut",
  bilder: "Ihre Bilder",
  vereinbarungen: "Ergänzende Vereinbarungen",
  kueche: "Küche",
  bemerkungen: "Bemerkungen",
};

export const KV_FELD_ARTEN = ["text", "langtext", "zustaendig", "zeigen"] as const;
export type KvFeldArt = (typeof KV_FELD_ARTEN)[number];

/** Ein konkretes Feld im Katalog eines Stands (aus der Basis gelesen). */
export interface KvFeld {
  /** Stabil, `<bereich>:<ziel>:<feld>` (siehe Schlüssel-Schema unten). */
  schluessel: string;
  abschnitt: KvAbschnitt;
  /** Zeile im Formular, z. B. „Kleiderschrank 3-türig“ beim Umzugsgut, „Transport“ bei Leistungen. */
  gruppe?: string;
  /** „Notiz“, „Montage“ */
  label: string;
  art: KvFeldArt;
  /** Höchstzahl Zeichen bei `text` und `langtext`. */
  max?: number;
  /** Wert aus Kalkulation und Lead, so wie er ohne Änderung gedruckt wird. */
  basis: KvWert;
  /** Nur `zustaendig`: true genau dann, wenn `basis === "company"` (Entscheidung 5, Firma nur zurück). */
  firmaWaehlbar?: boolean;
  /** Nur `bilder`: Anhang-ID für das Vorschaubild (`/api/v1/deals/<id>/attachments/<anhangId>`). */
  anhangId?: string;
}

export interface KvBasis {
  renderer: KvRenderer;
  /** Nur geprüfte Felder (VPS: `KV_FELDER_VPS_GEPRUEFT`), in KV-Reihenfolge. */
  felder: KvFeld[];
}

export interface KvAenderung {
  schluessel: string;
  wert: KvWert;
  /** Basiswert beim Setzen (für das Mitwandern, Spec 7.6). */
  vorher: KvWert;
  quelle: "hand" | "ki";
  /** userId; bei KI der Mensch, der übernommen hat. */
  von: string;
  /** ISO-Zeitpunkt. */
  am: string;
}

export const KV_KONFLIKT_ARTEN = ["basis_geaendert", "ziel_fehlt", "nicht_erlaubt"] as const;
export type KvKonfliktArt = (typeof KV_KONFLIKT_ARTEN)[number];
export type KvKonfliktStatus = "offen" | "uebernommen" | "verworfen";

export interface KvKonflikt {
  aenderung: KvAenderung;
  art: KvKonfliktArt;
  /** Basiswert im neuen KV; null bei `ziel_fehlt`. */
  basisJetzt: KvWert | null;
  status: KvKonfliktStatus;
  entschiedenVon?: string;
  entschiedenAm?: string;
}

/** Gründe, aus denen ein einzelner Eintrag (Hand oder KI) abgelehnt wird. */
export const KV_ABLEHNUNGEN = ["UNBEKANNT", "TYP", "ZU_LANG", "PREIS", "FIRMA_GESPERRT"] as const;
export type KvAblehnung = (typeof KV_ABLEHNUNGEN)[number];

export const KV_EDITOR_FEHLER = [
  "NUR_MENSCH",
  "KEIN_KV",
  "UNGUELTIG",
  "STAND_VERALTET",
  "STAND_NICHT_FERTIG",
  "AKTUELL_GEAENDERT",
  "KALKULATION_NEU",
  "ANNAHME_AKTIV",
  "ANGABEN_FEHLEN",
  "VPS_FEHLER",
  "KI_FEHLER",
] as const;
export type KvEditorFehler = (typeof KV_EDITOR_FEHLER)[number];

// ════════════════════════════════════════════════════════════════════════
// Stand (Tabelle `kv_staende`, Migration 0070)
// ════════════════════════════════════════════════════════════════════════

/**
 * `neu` neuer KV aus der Kalkulation ohne frühere Änderungen, `ausgang` Altbestand
 * übernommen (Spec 7.4), `hand`, `ki`, `mitgewandert` neuer KV mit übernommenen Änderungen.
 */
export const KV_STAND_QUELLEN = ["neu", "ausgang", "hand", "ki", "mitgewandert"] as const;
export type KvStandQuelle = (typeof KV_STAND_QUELLEN)[number];

export const KV_STAND_STATUS = ["druckt", "fertig", "fehler"] as const;
export type KvStandStatus = (typeof KV_STAND_STATUS)[number];

/**
 * `document_render_jobs.kv_stand_ziel`: `entwurf` = PDF gehört in den Stand, nie in
 * `deal_documents`; `aktuell` = normaler KV aus der Kalkulation, der zusätzlich seinen
 * Stand verknüpft (Spec 5.1, 7.3, 7.6). Ein Stand nur mit Ziel; ein Ziel ohne Stand
 * (`kv_stand_id` durch ON DELETE SET NULL geleert) heißt „Stand gelöscht, nichts ablegen“.
 */
export const KV_STAND_ZIELE = ["entwurf", "aktuell"] as const;
export type KvStandZiel = (typeof KV_STAND_ZIELE)[number];

/**
 * Grundgerüst eines Stands (`kv_staende.grundlage`).
 * VPS: das Datenpaket wie vom Browser bzw. Editor gesendet, ohne die Schlüssel aus
 * `KV_GRUNDLAGE_OHNE` und ohne `preise.anzahlung_betrag_eur` / `preise.anzahlung_zahlungsweg`.
 * CRM: `{ copy }`.
 */
export type KvGrundlageVps = Record<string, unknown>;
export interface KvGrundlageCrm {
  copy: { intro?: string; closing?: string; remarks?: string };
}
export type KvGrundlage = KvGrundlageVps | KvGrundlageCrm;

/** Schlüssel des VPS-Pakets, die nie in die Grundlage kommen (beim Druck frisch). */
export const KV_GRUNDLAGE_OHNE = ["_images", "_rechnung", "_document_context", "_calculation_version_id", "_kv_stand"] as const;
/** Schlüssel unter `preise`, die nie in die Grundlage kommen (kommen aus der Quotation). */
export const KV_GRUNDLAGE_PREISE_OHNE = ["anzahlung_betrag_eur", "anzahlung_zahlungsweg"] as const;

/** Person in Verlauf und Ansicht (Anzeigename aus `users`). */
export interface KvPerson {
  id: string;
  name: string;
}

/** Kopf eines Stands für Verlauf und Ansicht (ohne PDF). */
export interface KvStandKopf {
  id: string;
  /** „Stand 1, 2, …“ je Deal. */
  nummer: number;
  vorgaengerId: string | null;
  renderer: KvRenderer;
  /** Nummer der Kalkulationsversion (`deal_calculation_versions.version`), null ohne Version. */
  kalkulationVersion: number | null;
  quelle: KvStandQuelle;
  status: KvStandStatus;
  fehler: string | null;
  aenderungen: KvAenderung[];
  offen: KvKonflikt[];
  /** Bei `quelle ki`: der Mensch, der übernommen hat („KI im Auftrag von …“). */
  erstelltVon: KvPerson | null;
  erstelltAm: string;
  gepushtVon: KvPerson | null;
  gepushtAm: string | null;
  /** `deal_document_id` ist das neueste KV-Dokument des Deals. */
  aktuell: boolean;
  dealDocumentId: string | null;
  grundlageRekonstruiert: boolean;
}

export interface KvEditorAnsicht {
  dealId: string;
  /** Anzeigename des Kunden, für „KV · <Kunde>“. */
  kunde: string | null;
  /** Firmenschlüssel wie `buildDealDataForDocs` („kottke“, „ceylan“). */
  firma: string | null;
  /** Neueste zuerst. Leer, wenn der Deal kein KV-Dokument hat (`hinweis: "kein_kv"`). */
  staende: KvStandKopf[];
  aktuellStandId: string | null;
  aktuellDokumentId: string | null;
  quotationVersionId: string | null;
  kalkulationVersion: number | null;
  annahme: { aktiv: boolean; am: string | null; standNummer: number | null };
  /** Nur lesend, z. B. „Gesamtpreis 1.620,00 € aus Kalkulation v3“. */
  preis: { text: string; kalkulationUrl: string };
  /** Hinweis oben im Editor: kein KV (Link Kalkulation) oder Ausgangs-KV rekonstruiert. */
  hinweis: "kein_kv" | "rekonstruiert" | null;
  /** Anzahl offener Konflikte im aktuellen bzw. neuesten Stand (gelber Streifen). */
  offeneKonflikte: number;
}

export interface KvUnterschiedZeile {
  schluessel: string;
  abschnitt: KvAbschnitt;
  gruppe?: string;
  label: string;
  vorher: KvWert;
  nachher: KvWert;
  /** `neu` Feld erstmals geändert, `geaendert` anderer Wert, `zurueck` auf Basis zurückgesetzt. */
  art: "neu" | "geaendert" | "zurueck";
}

export interface KvStandDetail extends KvStandKopf {
  /** Katalog mit Basiswerten (nur geprüfte Felder). */
  basis: KvBasis;
  /** Basis plus Änderungen, je Schlüssel. */
  werte: Record<string, KvWert>;
  /** Zum Vorgänger. */
  unterschied: KvUnterschiedZeile[];
}

// ════════════════════════════════════════════════════════════════════════
// Eingaben und Antworten der Routen (Plan Aufgabe 5)
// ════════════════════════════════════════════════════════════════════════

export interface StandAnlegenEingabe {
  vorgaengerId: string;
  setzen: { schluessel: string; wert: KvWert }[];
  zuruecksetzen: string[];
  quelle: "hand" | "ki";
  kiNachrichtId?: string;
}

export interface PushenEingabe {
  erwartetAktuellDokumentId: string | null;
  annahmeAufhebenBestaetigt?: boolean;
}

export interface KonflikteEingabe {
  standId: string;
  entscheidungen: { schluessel: string; aktion: "uebernehmen" | "verwerfen" }[];
}

export interface KvChatEingabe {
  standId: string;
  text: string;
}

export type KvKiAblehnung = KvAblehnung | "LEER";

export interface KiAntwort {
  antwort: string;
  vorschlaege: (KvUnterschiedZeile & { wert: KvWert })[];
  abgelehnt: { schluessel: string | null; grund: KvKiAblehnung }[];
  /** ID des `kv_editor.chat`-Ereignisses der KI-Antwort; geht als `kiNachrichtId` ins Speichern. */
  nachrichtId: string;
}

export interface PushenAntwort {
  stand: KvStandKopf;
  dealDocumentId: string;
  annahmeAufgehoben: boolean;
}

export interface KonflikteAntwort {
  stand: KvStandKopf;
  neuerEntwurf: KvStandKopf | null;
}

export interface KvChatBeitrag {
  rolle: "nutzer" | "ki";
  text: string;
  am: string;
  von: string | null;
  standId: string;
  vorschlaege?: KiAntwort["vorschlaege"];
  abgelehnt?: KiAntwort["abgelehnt"];
}

/** Payload des stillen Ereignisses `kv_editor.chat` in `activity_events` (nur angehängt, wie Plan 16). */
export interface KvChatEreignis {
  silent: true;
  rolle: "nutzer" | "ki";
  text: string;
  standId: string;
  vorschlaege?: KiAntwort["vorschlaege"];
  abgelehnt?: KiAntwort["abgelehnt"];
  /** userId des Menschen; bei der KI der Mensch, der gefragt hat. */
  von: string | null;
}

/** Zusatzdaten je Fehlercode in `{ error: { code, message, daten } }`. */
export interface KvEditorFehlerDaten {
  NUR_MENSCH: undefined;
  KEIN_KV: undefined;
  UNGUELTIG: { abgelehnt: { schluessel: string | null; grund: KvAblehnung }[] } | undefined;
  /** Liste des neuesten Stands für den Zusammenführen-Dialog. */
  STAND_VERALTET: { neuester: KvStandKopf };
  STAND_NICHT_FERTIG: { status: KvStandStatus };
  /** „Nuri hat inzwischen Stand 6 gepusht“. */
  AKTUELL_GEAENDERT: { aktuellStandNummer: number | null; gepushtVon: string | null };
  KALKULATION_NEU: { kalkulationVersion: number | null };
  ANNAHME_AKTIV: { am: string | null; standNummer: number | null };
  /** Text aus `angabenFehlenText`. */
  ANGABEN_FEHLEN: { text: string };
  VPS_FEHLER: undefined;
  KI_FEHLER: undefined;
}

export interface KvEditorFehlerAntwort<C extends KvEditorFehler = KvEditorFehler> {
  error: { code: C; message: string; daten?: KvEditorFehlerDaten[C] };
}

export const KV_EDITOR_STATUS: Record<KvEditorFehler, number> = {
  NUR_MENSCH: 403,
  KEIN_KV: 404,
  UNGUELTIG: 400,
  STAND_VERALTET: 409,
  STAND_NICHT_FERTIG: 409,
  AKTUELL_GEAENDERT: 409,
  KALKULATION_NEU: 409,
  ANNAHME_AKTIV: 409,
  ANGABEN_FEHLEN: 400,
  VPS_FEHLER: 502,
  KI_FEHLER: 504,
};

/** Interne Texte (du, ohne Gedankenstrich). Fehlercodes und Ablehnungsgründe. */
export const KV_EDITOR_TEXT: Record<KvEditorFehler | KvAblehnung, string> = {
  NUR_MENSCH: "Den KV-Editor bedienen nur Menschen. Agenten können hier nichts ändern.",
  KEIN_KV: "Noch kein KV. Erst in der Kalkulation erstellen.",
  UNGUELTIG: "Einige Änderungen sind so nicht möglich. Bitte prüf die markierten Felder.",
  STAND_VERALTET: "Inzwischen wurde ein neuerer Stand gespeichert.",
  STAND_NICHT_FERTIG: "Dieser Stand ist noch nicht fertig gedruckt.",
  AKTUELL_GEAENDERT: "Inzwischen wurde ein anderer Stand gepusht.",
  KALKULATION_NEU: "Die Kalkulation ist inzwischen neuer. Übertrag deine Änderungen auf den neuen KV.",
  ANNAHME_AKTIV: "Der Kunde hat den KV schon angenommen. Mit dem Pushen wird die Annahme aufgehoben.",
  ANGABEN_FEHLEN: "Am Lead fehlen Angaben für den KV. Bitte in der Akte ergänzen.",
  VPS_FEHLER: "Druck konnte nicht starten. Bitte gleich nochmal speichern.",
  KI_FEHLER: "Die KI braucht gerade zu lange. Bitte nochmal schicken.",
  UNBEKANNT: "Dieses Feld lässt sich im KV-Editor nicht ändern.",
  TYP: "Der Wert passt nicht zu diesem Feld.",
  ZU_LANG: "Der Text ist zu lang.",
  PREIS: "Beträge gehören nicht in den Text. Preise änderst du in der Kalkulation.",
  FIRMA_GESPERRT: "Im Preis nicht enthalten. Über die Kalkulation ändern.",
};

/** Zweite Anfrage an die KI, während die erste noch läuft (409 `UNGUELTIG`). */
export const KV_KI_LAEUFT_TEXT = "Die KI arbeitet noch an deiner letzten Nachricht.";
/** KI hat nichts Gültiges geliefert (Ablehnung `LEER`). */
export const KV_KI_LEER_TEXT = "Dazu kann ich im KV nichts ändern.";
/** Hinweise im Editor (Spec 7.4, Plan Aufgabe 0). */
export const KV_HINWEIS_KEIN_KV = "Noch kein KV. Erst in der Kalkulation erstellen.";
export const KV_HINWEIS_REKONSTRUIERT =
  "Dieser KV entstand vor dem Editor. Beim ersten Speichern wird neu gedruckt; ein früherer Sonderhinweis oder eigener Anschreibentext fehlt dann.";
export const KV_HINWEIS_FELDER_GEPRUEFT = "Felder werden geprüft. Bis dahin lässt sich dieser KV hier nicht ändern.";
/** Stand verworfen, weil die Kalkulation beim Ablegen schon neuer war (Spec 7.6). */
export const KV_STAND_VERWORFEN_TEXT = "KV verworfen, Kalkulation neuer";

// ════════════════════════════════════════════════════════════════════════
// Konstanten
// ════════════════════════════════════════════════════════════════════════

export const KV_CHAT_EVENT = "kv_editor.chat" as const;
export const KV_EDITOR_KI_SLUG = "deal.kv-editor" as const;
/** Anrede im KV-Text bei VPS-KVs (Kottke). Frage an den Inhaber offen; Empfehlung: wie das Dokument, Sie. */
export const KV_ANREDE_VPS: "sie" | "du" = "sie";

/** Abfrage eines druckenden Stands im Browser. */
export const KV_EDITOR_POLL_MS = 5_000;
/** Eigene Zeitgrenze der KI-Anfrage (Route `maxDuration = 120`). */
export const KV_KI_ZEITGRENZE_MS = 100_000;
/** Höchstzahl Änderungen je KI-Antwort; der Rest fällt weg. */
export const KV_KI_MAX_AENDERUNGEN = 30;
/** So viele frühere Chat-Beiträge gehen in den Prompt. */
export const KV_KI_VERLAUF_BEITRAEGE = 10;

/** Schlüssel für `pg_advisory_xact_lock(hashtext(...))`: Nummernvergabe, `STAND_VERALTET`, Push. */
export function kvEditorSperrSchluessel(dealId: string): string {
  return `kv-editor:${dealId}`;
}

/** Seite des Editors in der neuen Oberfläche. */
export function kvEditorUrl(dealId: string): string {
  return `/app/leads/${encodeURIComponent(dealId)}/kv`;
}

/** Basis der Routen (Plan Aufgabe 5). */
export function kvEditorApiPfad(dealId: string): string {
  return `/api/v1/deals/${encodeURIComponent(dealId)}/kv-editor`;
}

// ════════════════════════════════════════════════════════════════════════
// Schlüssel-Schema (Spec 6)
// ════════════════════════════════════════════════════════════════════════
//
// Form `<bereich>:<ziel>:<feld>`. `bereich` ist ein Abschnitt oder einer der
// Unterbereiche der Küche (`kueche-leistung`, `kueche-teil`, beide im Abschnitt
// `kueche`). Das Ziel ist eine Lead-Kennung (Umzugsgut-ID, Anhang-ID,
// Leistungsschlüssel), keine Position, darum stabil über Kalkulationsversionen.
// Das Ziel darf Doppelpunkte enthalten: `schluesselTeile` trennt am ersten und
// am letzten Doppelpunkt.

export const KV_BEREICHE = [...KV_ABSCHNITTE, "kueche-leistung", "kueche-teil"] as const;
export type KvBereich = (typeof KV_BEREICHE)[number];

/** Abschnitt eines Bereichs (`kueche-leistung`, `kueche-teil` → `kueche`). */
export function abschnittVon(bereich: KvBereich): KvAbschnitt {
  return bereich === "kueche-leistung" || bereich === "kueche-teil" ? "kueche" : bereich;
}

function istBereich(s: string): s is KvBereich {
  return (KV_BEREICHE as readonly string[]).includes(s);
}

/** Baut einen Schlüssel. Bereich und Feld ohne Doppelpunkt, das Ziel nicht leer. */
export function kvSchluessel(bereich: KvBereich, ziel: string, feld: string): string {
  if (!ziel || feld.includes(":")) throw new Error(`Ungültiger KV-Schlüssel: ${bereich}:${ziel}:${feld}`);
  return `${bereich}:${ziel}:${feld}`;
}

/** Zerlegt einen Schlüssel; null bei unbekanntem Bereich oder falscher Form. */
export function schluesselTeile(
  s: string
): { bereich: KvBereich; abschnitt: KvAbschnitt; ziel: string; feld: string } | null {
  if (typeof s !== "string") return null;
  const a = s.indexOf(":");
  const b = s.lastIndexOf(":");
  if (a <= 0 || b <= a + 1 || b === s.length - 1) return null;
  const bereich = s.slice(0, a);
  if (!istBereich(bereich)) return null;
  return { bereich, abschnitt: abschnittVon(bereich), ziel: s.slice(a + 1, b), feld: s.slice(b + 1) };
}

/**
 * Normalform eines Namens für Ziele ohne ID. Gleiche Regel wie
 * `positionSchluessel` in `lib/kalkulation-versionen` (Test hält beide gleich;
 * hier dupliziert, damit die Oberfläche den Rechner nicht mitlädt).
 */
export function kvNamensSchluessel(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLocaleLowerCase("de-DE");
}

/**
 * Ziel eines Umzugsguts ohne `deal_inventory_items.id` (Altbestand, MCP):
 * `n-<kvNamensSchluessel(name)>~<k>`, k = 1 für das erste Vorkommen dieses Namens.
 */
export function umzugsgutZielOhneId(name: string, k: number): string {
  return `n-${kvNamensSchluessel(name)}~${k}`;
}

/** Ziel eines Küchenteils: `<kvNamensSchluessel(name)>~<k>`, k = 1 für das erste Vorkommen. */
export function kuechenTeilZiel(name: string, k: number): string {
  return `${kvNamensSchluessel(name)}~${k}`;
}

// ════════════════════════════════════════════════════════════════════════
// Feste Felderliste (Spec 6.1, 6.2)
// ════════════════════════════════════════════════════════════════════════

/** Platzhalter im Muster: `{key}` Leistungsschlüssel, `{inventarId}`, `{attachmentId}`, `{teil}`. */
export type KvPlatzhalter = "key" | "inventarId" | "attachmentId" | "teil";

export interface KvFeldDef {
  /** z. B. "umzugsgut:{inventarId}:notiz"; für feste Ziele der Schlüssel selbst. */
  muster: string;
  bereich: KvBereich;
  abschnitt: KvAbschnitt;
  /** Festes Ziel oder Platzhalter. */
  ziel: { fest: string } | { platzhalter: KvPlatzhalter };
  feld: string;
  label: string;
  art: KvFeldArt;
  max?: number;
  /** Wohin der Wert beim Druck geht (Doku für `vpsAnwenden` / `crmAnwenden`). */
  wirkt: string;
}

type DefEingabe = Omit<KvFeldDef, "muster" | "abschnitt" | "ziel"> & { ziel: string };

function def(e: DefEingabe): KvFeldDef {
  const m = /^\{(key|inventarId|attachmentId|teil)\}$/.exec(e.ziel);
  return {
    ...e,
    muster: `${e.bereich}:${e.ziel}:${e.feld}`,
    abschnitt: abschnittVon(e.bereich),
    ziel: m ? { platzhalter: m[1] as KvPlatzhalter } : { fest: e.ziel },
  };
}

/** Freitextfelder der Küche (`kueche:<feld>:text`), Reihenfolge wie im KV. */
export const KV_KUECHE_TEXTFELDER = [
  "details",
  "dimensions",
  "customerPrep",
  "companyWork",
  "excluded",
  "otherContractor",
  "notes",
  "time",
] as const;
export type KvKuecheTextfeld = (typeof KV_KUECHE_TEXTFELDER)[number];

export const KV_KUECHE_TEXTFELD_LABEL: Record<KvKuecheTextfeld, string> = {
  details: "Details",
  dimensions: "Maße",
  customerPrep: "Vorbereitung durch den Kunden",
  companyWork: "Unsere Arbeiten",
  excluded: "Nicht enthalten",
  otherContractor: "Andere Gewerke",
  notes: "Hinweise",
  time: "Uhrzeit",
};

/** Leistungsschlüssel im VPS-Paket (Umzug) mit Anzeigenamen; unbekannte Schlüssel zeigen den Schlüssel. */
export const KV_LEISTUNGEN_UMZUG: Record<string, string> = {
  transport: "Transport",
  packing: "Einpacken",
  unpacking: "Auspacken",
  dismantling: "Möbeldemontage",
  assembly: "Möbelmontage",
  parkingPickup: "Halteverbot Auszug",
  parkingDestination: "Halteverbot Einzug",
  materials: "Packmaterial",
};

/** Leistungsschlüssel im VPS-Paket (Küche). */
export const KV_LEISTUNGEN_KUECHE: Record<string, string> = {
  installation: "Küchenmontage",
  oldKitchenDismantling: "Abbau der alten Küche",
  delivery: "Lieferung",
  worktop: "Arbeitsplatte",
  appliances: "Elektrogeräte",
  connections: "Anschlüsse",
  packagingRemoval: "Verpackung entsorgen",
  disposal: "Entsorgung",
};

/** VPS (Kottke, Ceylan-Altbestand), Spec 6.1, Reihenfolge = KV. */
export const KV_FELDER_VPS: readonly KvFeldDef[] = [
  def({ bereich: "uebersicht", ziel: "termin", feld: "zeit", label: "Uhrzeit", art: "text", max: 120, wirkt: "document_details.time" }),
  def({ bereich: "uebersicht", ziel: "auszug", feld: "details", label: "Auszug, Hinweis", art: "text", max: 300, wirkt: "document_details.from.details" }),
  def({ bereich: "uebersicht", ziel: "einzug", feld: "details", label: "Einzug, Hinweis", art: "text", max: 300, wirkt: "document_details.to.details" }),
  def({ bereich: "uebersicht", ziel: "umzugsgut", feld: "text", label: "Umzugsgut", art: "langtext", max: 500, wirkt: "auftrag.volumen" }),
  def({ bereich: "leistungen", ziel: "{key}", feld: "notiz", label: "Notiz", art: "langtext", max: 500, wirkt: "document_details.services[key].note" }),
  def({ bereich: "leistungen", ziel: "{key}", feld: "zustaendig", label: "Zuständig", art: "zustaendig", wirkt: "document_details.services[key].owner" }),
  def({ bereich: "umzugsgut", ziel: "{inventarId}", feld: "bezeichnung", label: "Bezeichnung", art: "text", max: 120, wirkt: "document_details.inventory[i].name" }),
  def({ bereich: "umzugsgut", ziel: "{inventarId}", feld: "raum", label: "Raum", art: "text", max: 60, wirkt: "document_details.inventory[i].room" }),
  def({ bereich: "umzugsgut", ziel: "{inventarId}", feld: "notiz", label: "Notiz", art: "text", max: 300, wirkt: "document_details.inventory[i].note" }),
  def({ bereich: "umzugsgut", ziel: "{inventarId}", feld: "demontage", label: "Demontage", art: "zustaendig", wirkt: "document_details.inventory[i].dismantling" }),
  def({ bereich: "umzugsgut", ziel: "{inventarId}", feld: "montage", label: "Montage", art: "zustaendig", wirkt: "document_details.inventory[i].assembly" }),
  def({ bereich: "bilder", ziel: "{attachmentId}", feld: "zeigen", label: "Im KV zeigen", art: "zeigen", wirkt: "_image_attachment_ids (nur ausblenden)" }),
  def({ bereich: "vereinbarungen", ziel: "text", feld: "text", label: "Ergänzende Vereinbarungen", art: "langtext", max: 2000, wirkt: "auftrag.besonderheiten" }),
  ...KV_KUECHE_TEXTFELDER.map((f) =>
    def({ bereich: "kueche", ziel: f, feld: "text", label: KV_KUECHE_TEXTFELD_LABEL[f], art: "langtext", max: 1000, wirkt: `document_details.kitchen.${f}` })
  ),
  def({ bereich: "kueche-leistung", ziel: "{key}", feld: "notiz", label: "Notiz", art: "langtext", max: 500, wirkt: "document_details.kitchen.services[key].note" }),
  def({ bereich: "kueche-leistung", ziel: "{key}", feld: "zustaendig", label: "Zuständig", art: "zustaendig", wirkt: "document_details.kitchen.services[key].owner" }),
  def({ bereich: "kueche-teil", ziel: "{teil}", feld: "notiz", label: "Notiz", art: "text", max: 300, wirkt: "document_details.kitchen.components[i].note" }),
];

/** CRM-Renderer (Ceylan), Spec 6.2, Reihenfolge = KV. */
export const KV_FELDER_CRM: readonly KvFeldDef[] = [
  def({ bereich: "anschreiben", ziel: "einleitung", feld: "text", label: "Einleitung", art: "langtext", max: 2000, wirkt: "copy.intro (Absätze mit Leerzeile)" }),
  def({ bereich: "uebersicht", ziel: "zusammenfassung", feld: "text", label: "Leistung", art: "langtext", max: 1000, wirkt: "RenderInput.quotation.summary (nur PDF, nicht die Quotation)" }),
  def({ bereich: "bemerkungen", ziel: "text", feld: "text", label: "Bemerkungen", art: "langtext", max: 2000, wirkt: "copy.remarks" }),
  def({ bereich: "anschreiben", ziel: "schluss", feld: "text", label: "Schluss", art: "langtext", max: 2000, wirkt: "copy.closing" }),
];

/**
 * Ergebnis der VPS-Feldprüfung V1 (Muster aus `KV_FELDER_VPS`). Nur diese Felder
 * erscheinen in Formular und KI-Katalog; ungeprüfte bleiben im Code, sind aber aus.
 * Leer bis V1 durch ist: das VPS-Formular zeigt dann `KV_HINWEIS_FELDER_GEPRUEFT`.
 * `zustaendig` und `zeigen` haben keinen Markierungstext; V1 prüft sie über die
 * Zeile bzw. das Bild im PDF.
 */
export const KV_FELDER_VPS_GEPRUEFT: ReadonlySet<string> = new Set<string>([]);

export function kvFelderVon(renderer: KvRenderer): readonly KvFeldDef[] {
  return renderer === "vps" ? KV_FELDER_VPS : KV_FELDER_CRM;
}

/** Felddefinition zu einem konkreten Schlüssel, null wenn der Schlüssel nicht in der Liste steht. */
export function feldDefFuer(renderer: KvRenderer, schluessel: string): KvFeldDef | null {
  const t = schluesselTeile(schluessel);
  if (!t) return null;
  for (const d of kvFelderVon(renderer)) {
    if (d.bereich !== t.bereich || d.feld !== t.feld) continue;
    if ("fest" in d.ziel ? d.ziel.fest === t.ziel : true) return d;
  }
  return null;
}

/** Ist das Feld zu diesem Schlüssel freigeschaltet? CRM: immer, VPS: nur nach V1. */
export function feldFreigeschaltet(
  renderer: KvRenderer,
  schluessel: string,
  gepruefte: ReadonlySet<string> = KV_FELDER_VPS_GEPRUEFT
): boolean {
  const d = feldDefFuer(renderer, schluessel);
  if (!d) return false;
  return renderer === "crm" || gepruefte.has(d.muster);
}

// ════════════════════════════════════════════════════════════════════════
// Kernfunktionen (Plan Aufgabe 1, `lib/kv-editor-anwenden.ts`), als Typen
// ════════════════════════════════════════════════════════════════════════

/** Teile des VPS-Pakets nach `attachDocumentJobContext`, vor den Änderungen. */
export interface VpsPaketTeile {
  details: QuotationDocumentDetails;
  /** `params.auftrag` */
  auftrag: Record<string, unknown>;
  /** Je `details.inventory[i]` die `deal_inventory_items.id`; null = ohne ID (Altbestand). */
  inventarIds: (string | null)[];
  /** `_image_attachment_ids` der Grundlage. */
  bildIds: string[];
}

export interface VpsAngewendet {
  details: QuotationDocumentDetails;
  auftrag: Record<string, unknown>;
  bildIds: string[];
}

export interface PruefErgebnis {
  ok: { schluessel: string; wert: KvWert; vorher: KvWert }[];
  abgelehnt: { schluessel: string; grund: KvAblehnung }[];
}

export interface AbgleichErgebnis {
  /** Ziel da, Basis gleich `vorher`: wird angewendet. */
  passend: KvAenderung[];
  /** Ziel da, Basis schon gleich `wert`: fällt still weg. */
  erledigt: KvAenderung[];
  /** `basis_geaendert`, `ziel_fehlt`, `nicht_erlaubt`, alle mit Status `offen`. */
  konflikte: KvKonflikt[];
}

export interface ZusammenfuehrenErgebnis {
  liste: KvAenderung[];
  /** Gleiches Feld mit verschiedenen Werten: je Feld „meins“ oder „deren“ wählen. */
  konflikte: { schluessel: string; meins: KvAenderung | null; deren: KvAenderung | null }[];
}

export interface PushPruefEingabe {
  status: KvStandStatus;
  standVersionId: string | null;
  quotationVersionId: string | null;
  aktuellDokumentId: string | null;
  erwartetAktuellDokumentId: string | null;
  schonGepusht: boolean;
  annahmeAktiv: boolean;
  annahmeAufhebenBestaetigt: boolean;
}

export type PushPruefErgebnis = { ok: true; annahmeAufheben: boolean } | { ok: false; fehler: KvEditorFehler };

/**
 * Was `lib/kv-editor-anwenden.ts` exportiert. Dort zur Prüfung:
 * `const _vertrag: KvEditorKern = { vpsBasis, vpsAnwenden, … };`
 *
 * Regeln (Plan Aufgabe 1): Umzugsgut-Ziel = Inventar-ID oder `umzugsgutZielOhneId`;
 * `zeigen` nur `true → false` und zurück; `zustaendig` `company` nur bei
 * `basis === "company"` (`FIRMA_GESPERRT`); Text getrimmt, leer erlaubt, über `max`
 * → `ZU_LANG`; Betrag (Regel `BETRAG` aus `lib/ohne-preisangaben.ts`) → `PREIS`;
 * Schlüssel nicht im Katalog der Basis → `UNBEKANNT`; falscher Typ → `TYP`.
 * Anwenden ändert nie `preise`, Mengen, `validUntil`, `cardAgreed`.
 */
export interface KvEditorKern {
  /** Katalog aus dem Paket; nur Felder, deren Muster in `gepruefte` steht. */
  vpsBasis(p: VpsPaketTeile, gepruefte: ReadonlySet<string>): KvBasis;
  vpsAnwenden(p: VpsPaketTeile, aenderungen: readonly KvAenderung[]): VpsAngewendet;
  /** Katalog aus dem gedruckten Modell ohne Änderungen (Absätze mit Leerzeile verbunden). */
  crmBasis(model: Pick<DocumentModel, "intro" | "closing" | "remarks" | "summary">): KvBasis;
  crmAnwenden(input: RenderInput, aenderungen: readonly KvAenderung[]): RenderInput;
  abgleichen(basis: KvBasis, aenderungen: readonly KvAenderung[]): AbgleichErgebnis;
  pruefeEingabe(basis: KvBasis, setzen: readonly { schluessel: string; wert: unknown }[]): PruefErgebnis;
  /** Neue vollständige Liste; ein Wert gleich der Basis entfernt die Änderung. */
  listeFortschreiben(
    vorher: readonly KvAenderung[],
    ok: readonly { schluessel: string; wert: KvWert; vorher: KvWert }[],
    zuruecksetzen: readonly string[],
    wer: { quelle: "hand" | "ki"; von: string; am: string }
  ): KvAenderung[];
  /** Dreiwege: gemeinsamer Vorgänger, meine Liste, die inzwischen gespeicherte. */
  zusammenfuehren(
    gemeinsam: readonly KvAenderung[],
    meins: readonly KvAenderung[],
    deren: readonly KvAenderung[]
  ): ZusammenfuehrenErgebnis;
  standUnterschied(basis: KvBasis, alt: readonly KvAenderung[], neu: readonly KvAenderung[]): KvUnterschiedZeile[];
  /** Reihenfolge: nicht fertig, schon gepusht (`UNGUELTIG`), Aktuell geändert, Kalkulation neu, Annahme. */
  pushPruefung(e: PushPruefEingabe): PushPruefErgebnis;
}

// ════════════════════════════════════════════════════════════════════════
// KI rein (Plan Aufgabe 4a, `lib/kv-editor-ki.ts`), als Typen
// ════════════════════════════════════════════════════════════════════════

export interface KiNormalisiert {
  antwort: string;
  vorschlaege: { schluessel: string; wert: KvWert; vorher: KvWert }[];
  abgelehnt: { schluessel: string | null; grund: KvKiAblehnung }[];
}

export interface KvEditorKiRein {
  kiAntwortNormalisieren(roh: unknown, basis: KvBasis, aktuell: Record<string, KvWert>): KiNormalisiert;
  /** U+2014 und U+2013 mit Leerzeichen → ", "; Bindestrich in Wörtern bleibt. */
  ohneGedankenstrich(text: string): string;
  /** "schluessel | Abschnitt | Gruppe | Label | Art | Werte | max | aktuell" */
  katalogZeilen(basis: KvBasis, aktuell: Record<string, KvWert>): string[];
}

// ════════════════════════════════════════════════════════════════════════
// Dienst (Plan Aufgabe 3 `services/kv-editor.ts`, 4b `services/kv-editor-ki.ts`)
// ════════════════════════════════════════════════════════════════════════

/**
 * Öffentliche Dienstfunktionen, gegen die die Routen (Aufgabe 5) bauen. Die
 * Umsetzung darf je Funktion einen letzten optionalen Parameter für Fakes haben
 * (`KvEditorOptionen` im Dienst). Fehler als `KvEditorFehlerKlasse` mit `code`
 * aus `KvEditorFehler` und `daten` nach `KvEditorFehlerDaten`.
 */
export interface KvEditorDienst {
  /** Legt bei Bedarf „Stand 1, Ausgangs-KV“ an (Spec 7.4). */
  ansicht(ws: string, deal: string): Promise<KvEditorAnsicht>;
  standLesen(ws: string, deal: string, standId: string): Promise<KvStandDetail>;
  standPdf(
    ws: string,
    deal: string,
    standId: string
  ): Promise<{ fileName: string; mimeType: string; bytes: Buffer } | null>;
  standAnlegen(ws: string, deal: string, e: StandAnlegenEingabe, userId: string): Promise<KvStandKopf>;
  neuDrucken(ws: string, deal: string, standId: string, userId: string): Promise<KvStandKopf>;
  pushen(ws: string, deal: string, standId: string, e: PushenEingabe, userId: string): Promise<PushenAntwort>;
  konflikteEntscheiden(ws: string, deal: string, e: KonflikteEingabe, userId: string): Promise<KonflikteAntwort>;
  /** `KALKULATION_NEU`: Liste dieses Stands auf den aktuellen KV legen. */
  uebertragen(ws: string, deal: string, standId: string, userId: string): Promise<KvStandKopf>;
  kvChat(ws: string, deal: string, e: KvChatEingabe, userId: string): Promise<KiAntwort>;
  kvChatVerlauf(ws: string, deal: string): Promise<KvChatBeitrag[]>;
}

/** Haken für neue KVs aus der Kalkulation (Route `/api/tools/run`, `storeCommercialDocument`). */
export interface KvStandZumNeuenKvEingabe {
  renderer: KvRenderer;
  grundlage: KvGrundlage;
  basis: KvBasis;
  /** Änderungsliste des Quell-Stands (leer: Stand `neu`). */
  quelle: KvAenderung[];
  calculationVersionId: string | null;
  renderJobId: string | null;
  dealDocumentId: string | null;
  userId: string | null;
}

export interface KvEditorHaken {
  kvEditorBeimNeuenKv(ws: string, deal: string): Promise<{ quelle: { id: string; aenderungen: KvAenderung[] } | null }>;
  kvEditorStandZumNeuenKv(ws: string, deal: string, e: KvStandZumNeuenKvEingabe): Promise<KvStandKopf>;
}
