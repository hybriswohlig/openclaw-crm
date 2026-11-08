/**
 * Vertrag Plan 11 „Bewertungen und Kunden“ (Meilenstein 3).
 * Ziel: apps/web/src/lib/bewertungen-kunden.ts
 *
 * Rein: keine Datenbank, kein Netz. Nur Typen, Konstanten und reine Funktionen,
 * die Treiber, Routen, Portal und Oberfläche gemeinsam benutzen.
 */
import { canonicalizePhone } from "@/lib/identity/canonical";
import type { Kontaktart } from "@/lib/kontaktart";
import { isQuietHoursBerlin } from "@/lib/reviews/quiet-hours";
import type { ManuellAnrede, ManuellMarke } from "@/lib/reviews/manuell";
import type { StageCategory } from "@/lib/wartet";

// ─── Modus je Firma ───────────────────────────────────────────────────────────

/** `company_settings.bewertung_modus`. Ohne Zeile gilt „aus“. */
export const BEWERTUNG_MODI = ["aus", "entwurf", "senden"] as const;
export type BewertungModus = (typeof BEWERTUNG_MODI)[number];

export function istBewertungModus(v: unknown): v is BewertungModus {
  return typeof v === "string" && (BEWERTUNG_MODI as readonly string[]).includes(v);
}

export const BEWERTUNG_MODUS_TEXT: Record<BewertungModus, string> = {
  aus: "Aus: Bewertungen nur von Hand.",
  entwurf: "Entwurf: Fällige Anfragen erscheinen zur Freigabe, nichts geht von selbst raus.",
  senden: "Senden: Fällige Anfragen gehen im nächsten erlaubten Zeitfenster raus, nur mit Einwilligung.",
};

/**
 * Google-Hinweis in der Rechnungsnachricht (`invoice_ready`): nur solange die
 * Automatik der Firma aus ist (Übersicht B3). `null` = keine Einstellung = aus.
 */
export function rechnungMitGoogleHinweis(modus: BewertungModus | null): boolean {
  return modus === null || modus === "aus";
}

// ─── Zeiten ───────────────────────────────────────────────────────────────────

/** Anker (vollständig bezahlt) plus ein Tag (Spec 3.8, Übersicht B1). */
export const ANKER_VERZUG_MS = 24 * 60 * 60 * 1000;
/** Nach Anker + Verzug: so lange darf die Automatik senden, danach nur noch von Hand. */
export const AUTO_FRIST_TAGE = 14;
/** Höchstens so viele Sendeversuche je Cron-Lauf (maxDuration 60). */
export const AUTO_MAX_JE_LAUF = 10;
/** Klick-IP und User-Agent bleiben so lange (Übersicht B4). */
export const KLICK_AUFBEWAHRUNG_TAGE = 90;
/** Ein Token im Zustand „anspruch“ ohne Abschluss gilt danach als „unklar“ (Prozess abgebrochen). */
export const ANSPRUCH_UNKLAR_NACH_MS = 10 * 60 * 1000;
/** Backfill vom 09.05.2026 setzte `do_not_contact_review` auf alle damaligen Deals. */
export const BACKFILL_STICHTAG = new Date("2026-05-10T00:00:00.000Z");

const TAG_MS = 24 * 60 * 60 * 1000;

function berlinTeile(d: Date): { y: number; m: number; t: number; h: number; min: number; wochentag: number } {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Berlin",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    hour12: false,
  });
  const p = Object.fromEntries(fmt.formatToParts(d).map((x) => [x.type, x.value]));
  const tage = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return {
    y: Number(p.year),
    m: Number(p.month),
    t: Number(p.day),
    h: Number(p.hour) % 24,
    min: Number(p.minute),
    wochentag: tage.indexOf(String(p.weekday)),
  };
}

/** Berliner Wandzeit → UTC (Sommer- und Winterzeit über Intl, zwei Näherungen). */
function berlinZuUtc(y: number, m: number, t: number, h: number): Date {
  let utc = Date.UTC(y, m - 1, t, h, 0, 0);
  for (let i = 0; i < 2; i++) {
    const b = berlinTeile(new Date(utc));
    const alsUtc = Date.UTC(b.y, b.m - 1, b.t, b.h, b.min, 0);
    utc += Date.UTC(y, m - 1, t, h, 0, 0) - alsUtc;
  }
  return new Date(utc);
}

/**
 * Frühester Zeitpunkt ab `ab`, an dem eine Bewertungsanfrage rausdarf:
 * Mo bis Sa 9 bis 19 Uhr Berlin, sonntags nie. Liegt `ab` im Fenster, `ab`
 * selbst. Gleiche Regel wie `isQuietHoursBerlin` (Test prüft beide gegeneinander).
 */
export function naechstesFenster(ab: Date): Date {
  if (!isQuietHoursBerlin(ab)) return ab;
  const b = berlinTeile(ab);
  // Heute 9 Uhr, falls vor 9 und kein Sonntag; sonst der nächste Tag, der kein Sonntag ist.
  let tagUtc = Date.UTC(b.y, b.m - 1, b.t);
  let wochentag = b.wochentag;
  if (!(b.h < 9 && wochentag !== 0)) {
    do {
      tagUtc += TAG_MS;
      wochentag = (wochentag + 1) % 7;
    } while (wochentag === 0);
  }
  const d = new Date(tagUtc);
  return berlinZuUtc(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), 9);
}

/** „Mo 09.11., 9 Uhr“ für Dialog und Liste. */
export function fensterText(d: Date): string {
  const b = berlinTeile(d);
  const tage = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
  const zwei = (n: number) => String(n).padStart(2, "0");
  const uhr = b.min === 0 ? `${b.h} Uhr` : `${b.h}:${zwei(b.min)} Uhr`;
  return `${tage[b.wochentag]} ${zwei(b.t)}.${zwei(b.m)}., ${uhr}`;
}

export function klickDatenAbgelaufen(clickedAt: Date, jetzt: Date): boolean {
  return jetzt.getTime() - clickedAt.getTime() > KLICK_AUFBEWAHRUNG_TAGE * TAG_MS;
}

// ─── Token und Vormerkung ────────────────────────────────────────────────────

/** `review_tokens.zustand` (Migration 0063). */
export const TOKEN_ZUSTAENDE = ["anspruch", "gesendet", "unklar"] as const;
export type TokenZustand = (typeof TOKEN_ZUSTAENDE)[number];
/** `review_tokens.quelle`. „alt“ = vor 0063 angelegt. */
export type TokenQuelle = "hand" | "vorgemerkt" | "automatik" | "alt";

/** Wie ein Token in Liste und Prüfung zählt. Jeder Token sperrt ein neues Senden (SCHON_GESENDET). */
export type TokenLage = "laeuft" | "gesendet" | "geklickt" | "unklar";

export function tokenLage(t: { zustand: TokenZustand; createdAt: Date; clickedAt: Date | null }, jetzt: Date): TokenLage {
  if (t.clickedAt) return "geklickt";
  if (t.zustand === "gesendet") return "gesendet";
  if (t.zustand === "unklar") return "unklar";
  return jetzt.getTime() - t.createdAt.getTime() > ANSPRUCH_UNKLAR_NACH_MS ? "unklar" : "laeuft";
}

/** Nur ein ungeklickter Token in Lage „unklar“ darf nach Prüfung im Gespräch freigegeben werden. */
export function tokenFreigebbar(lage: TokenLage): boolean {
  return lage === "unklar";
}

/** `review_vormerkungen.art`: hand = Knopf außerhalb der Ruhezeit, entwurf = Modus Entwurf, auto = Modus Senden. */
export const VORMERKUNG_ARTEN = ["hand", "entwurf", "auto"] as const;
export type VormerkungArt = (typeof VORMERKUNG_ARTEN)[number];
export const VORMERKUNG_STATUS = ["offen", "gesendet", "verworfen", "gesperrt"] as const;
export type VormerkungStatus = (typeof VORMERKUNG_STATUS)[number];

/** Darf der Treiber diese Vormerkung jetzt senden? Entwürfe sendet nie der Treiber. */
export function vormerkungSendebereit(
  v: { art: VormerkungArt; status: VormerkungStatus; faelligAb: Date; fristBis: Date },
  jetzt: Date
): "senden" | "warten" | "frist" | "nie" {
  if (v.status !== "offen" || v.art === "entwurf") return "nie";
  if (jetzt.getTime() > v.fristBis.getTime()) return "frist";
  if (jetzt.getTime() < v.faelligAb.getTime() || isQuietHoursBerlin(jetzt)) return "warten";
  return "senden";
}

// ─── Sperrgründe ──────────────────────────────────────────────────────────────

/** Codes der Handstrecke (`BewertungCode` in services/bewertung-anfragen.ts), hier gespiegelt. */
export type HandCode =
  | "STUFE"
  | "KEIN_LINK"
  | "SPERRE"
  | "EMPFAENGER"
  | "EINWILLIGUNG"
  | "KEIN_KANAL"
  | "FENSTER"
  | "RUHEZEIT"
  | "SCHON_GESENDET"
  | "TEXT";

/** Zusätzliche Gründe der Automatik und der Liste. */
export type ListenGrund =
  | "BESCHWERDE"
  | "ABGEMELDET"
  | "BESCHWERDE_STATUS"
  | "NICHT_KONTAKTIEREN"
  | "ALTSPERRE"
  | "VERSAND_UNKLAR"
  | "FEHLGESCHLAGEN"
  | "FRIST"
  | "KONTAKTART";

export type SperrGrund = HandCode | ListenGrund;

export const SPERR_TEXT: Record<SperrGrund, string> = {
  STUFE: "Noch nicht durchgeführt.",
  KEIN_LINK: "Kein gültiger Google-Bewertungslink für diese Firma.",
  SPERRE: "Kunde möchte keine Nachrichten zu Bewertungen.",
  EMPFAENGER: "WhatsApp-Kontakt keiner Person am Deal zugeordnet.",
  EINWILLIGUNG: "Keine Einwilligung des Kunden gespeichert.",
  KEIN_KANAL: "Kein WhatsApp-Gespräch direkt am Deal.",
  FENSTER: "24-Stunden-Fenster von WhatsApp geschlossen.",
  RUHEZEIT: "Außerhalb der Sendezeit (Mo bis Sa 9 bis 19 Uhr).",
  SCHON_GESENDET: "Schon angefragt.",
  TEXT: "Text ohne Bewertungslink oder STOP-Hinweis.",
  BESCHWERDE: "Beschwerde im Gespräch: bitte persönlich klären.",
  ABGEMELDET: "Kunde hat sich abgemeldet (STOP).",
  BESCHWERDE_STATUS: "Als Beschwerde markiert.",
  NICHT_KONTAKTIEREN: "„Keine Bewertungsanfrage“ ist gesetzt.",
  ALTSPERRE: "Gesperrt durch die Umstellung vom 09.05.2026.",
  VERSAND_UNKLAR: "Versand unklar: bitte im Gespräch prüfen.",
  FEHLGESCHLAGEN: "Senden fehlgeschlagen.",
  FRIST: "Frist der Automatik abgelaufen, nur noch von Hand.",
  KONTAKTART: "Kontaktart ist kein Kunde.",
};

// ─── Automatik: Kandidat ──────────────────────────────────────────────────────

export const BEWERTUNG_STUFEN: readonly StageCategory[] = ["done_unpaid", "paid"];
const STATUS_ANGEFRAGT = new Set(["sent_sms", "sent_whatsapp", "clicked", "review_left"]);
const STATUS_GESPERRT = new Set(["complaint_routed", "suppressed"]);

export interface AutoKandidatEingabe {
  modus: BewertungModus;
  /** `company_settings.bewertung_modus_seit`: Zeitpunkt, an dem der Modus zuletzt von „aus“ weg geschaltet wurde. */
  modusSeit: Date | null;
  /** Vollständig bezahlt am (Plan 9). */
  bezahltAm: Date | null;
  stufe: StageCategory | null;
  statusTitel: string | null;
  nichtKontaktieren: boolean;
  tokenDa: boolean;
  offeneVormerkung: boolean;
  kontaktart: Kontaktart | null;
}

export type AutoKandidat =
  | { ok: true; art: "entwurf" | "auto"; faelligAb: Date; fristBis: Date }
  | { ok: false; grund: "MODUS" | "KEIN_ANKER" | "ALTAUFTRAG" | "NOCH_NICHT" | "FRIST" | SperrGrund | "VORGEMERKT" };

/**
 * Entscheidet ohne Datenbank, ob der Treiber für einen Deal eine Vormerkung
 * anlegt. Altaufträge (Anker vor `modusSeit`) nie. Kein Aussieben nach
 * Zufriedenheit: Beschwerden prüft der Dienst erst beim Senden (BESCHWERDE).
 */
export function autoKandidat(e: AutoKandidatEingabe, jetzt: Date): AutoKandidat {
  if (e.modus === "aus") return { ok: false, grund: "MODUS" };
  if (!e.bezahltAm) return { ok: false, grund: "KEIN_ANKER" };
  if (!e.modusSeit || e.bezahltAm.getTime() < e.modusSeit.getTime()) return { ok: false, grund: "ALTAUFTRAG" };
  if (!e.stufe || !BEWERTUNG_STUFEN.includes(e.stufe)) return { ok: false, grund: "STUFE" };
  if (e.kontaktart && e.kontaktart !== "lead_kunde") return { ok: false, grund: "KONTAKTART" };
  if (e.tokenDa || (e.statusTitel && STATUS_ANGEFRAGT.has(e.statusTitel))) return { ok: false, grund: "SCHON_GESENDET" };
  if (e.statusTitel && STATUS_GESPERRT.has(e.statusTitel)) return { ok: false, grund: "BESCHWERDE_STATUS" };
  if (e.nichtKontaktieren) return { ok: false, grund: "NICHT_KONTAKTIEREN" };
  if (e.offeneVormerkung) return { ok: false, grund: "VORGEMERKT" };
  const berechtigt = e.bezahltAm.getTime() + ANKER_VERZUG_MS;
  if (jetzt.getTime() < berechtigt) return { ok: false, grund: "NOCH_NICHT" };
  const fristBis = new Date(berechtigt + AUTO_FRIST_TAGE * TAG_MS);
  if (jetzt.getTime() > fristBis.getTime()) return { ok: false, grund: "FRIST" };
  return {
    ok: true,
    art: e.modus === "entwurf" ? "entwurf" : "auto",
    faelligAb: naechstesFenster(new Date(Math.max(berechtigt, jetzt.getTime()))),
    fristBis,
  };
}

// ─── Arbeitsliste /app/bewertungen ────────────────────────────────────────────

export type BewertungListe = "freigabe" | "vorgemerkt" | "faellig" | "angefragt" | "geklickt" | "gesperrt";

export interface BewertungListenRoh {
  dealId: string;
  stufe: StageCategory | null;
  statusTitel: string | null;
  nichtKontaktieren: boolean;
  /** created_at des `do_not_contact_review`-Werts (für Altsperre). */
  nichtKontaktierenSeit: Date | null;
  token: { zustand: TokenZustand; createdAt: Date; clickedAt: Date | null; quelle: TokenQuelle | null } | null;
  vormerkung: { art: VormerkungArt; status: VormerkungStatus; faelligAb: Date; sperre: string | null } | null;
  hatPerson: boolean;
  hatGoogleLink: boolean;
  kontaktart: Kontaktart | null;
}

export interface BewertungLage {
  liste: BewertungListe;
  grund: SperrGrund | null;
  /** Bei „vorgemerkt“: nächster Sendezeitpunkt. */
  faelligAb: Date | null;
}

export function istAltsperre(r: Pick<BewertungListenRoh, "nichtKontaktieren" | "nichtKontaktierenSeit">): boolean {
  return r.nichtKontaktieren && !!r.nichtKontaktierenSeit && r.nichtKontaktierenSeit.getTime() < BACKFILL_STICHTAG.getTime();
}

/** Ordnet einen Deal genau einer Liste zu. Reihenfolge: Klick, Versand, Sperre, Vormerkung, fällig. */
export function bewertungLage(r: BewertungListenRoh, jetzt: Date): BewertungLage {
  const nichts = { grund: null, faelligAb: null };
  if (r.token) {
    const lage = tokenLage(r.token, jetzt);
    if (lage === "geklickt") return { liste: "geklickt", ...nichts };
    if (lage === "unklar") return { liste: "gesperrt", grund: "VERSAND_UNKLAR", faelligAb: null };
    return { liste: "angefragt", ...nichts };
  }
  if (r.statusTitel && STATUS_ANGEFRAGT.has(r.statusTitel)) {
    return { liste: r.statusTitel === "clicked" || r.statusTitel === "review_left" ? "geklickt" : "angefragt", ...nichts };
  }
  if (r.statusTitel === "complaint_routed") return { liste: "gesperrt", grund: "BESCHWERDE_STATUS", faelligAb: null };
  if (r.statusTitel === "suppressed") return { liste: "gesperrt", grund: "ABGEMELDET", faelligAb: null };
  if (r.nichtKontaktieren) return { liste: "gesperrt", grund: istAltsperre(r) ? "ALTSPERRE" : "NICHT_KONTAKTIEREN", faelligAb: null };
  if (r.kontaktart && r.kontaktart !== "lead_kunde") return { liste: "gesperrt", grund: "KONTAKTART", faelligAb: null };
  if (r.vormerkung?.status === "gesperrt" && r.vormerkung.sperre === "FRIST") {
    // Frist der Automatik vorbei: von Hand weiter möglich.
    return { liste: "faellig", grund: "FRIST", faelligAb: null };
  }
  if (r.vormerkung?.status === "gesperrt") {
    const g = r.vormerkung.sperre as SperrGrund | null;
    return { liste: "gesperrt", grund: g && g in SPERR_TEXT ? g : "FEHLGESCHLAGEN", faelligAb: null };
  }
  if (r.vormerkung?.status === "offen") {
    return r.vormerkung.art === "entwurf"
      ? { liste: "freigabe", grund: null, faelligAb: r.vormerkung.faelligAb }
      : { liste: "vorgemerkt", grund: null, faelligAb: r.vormerkung.faelligAb };
  }
  if (!r.hatPerson) return { liste: "gesperrt", grund: "EMPFAENGER", faelligAb: null };
  if (!r.hatGoogleLink) return { liste: "gesperrt", grund: "KEIN_LINK", faelligAb: null };
  return { liste: "faellig", ...nichts };
}

/** Marke aus dem Firmennamen des Deals (wie `markeAus` der Handstrecke ohne `brand`-Attribut). */
export function markeAusFirmenname(name: string | null | undefined): ManuellMarke | null {
  const n = name?.toLowerCase() ?? "";
  if (n.includes("kottke")) return "kottke";
  if (n.includes("ceylan")) return "ceylan";
  return null;
}

// ─── Einwilligung im Portal (kundensichtbar) ──────────────────────────────────

/**
 * Freiwilliger Haken bei der Annahme (Übersicht B2). Liegt außerhalb der
 * Annahmeregeln: weder `parseConfirmKvaPayload` noch `annahmeRegeln` kennen ihn.
 * Der Wortlaut landet unverändert in `consent_ledger.exact_wording`.
 */
export const EINWILLIGUNG_PORTAL: Record<ManuellAnrede, { frage: string; hinweis: string }> = {
  du: {
    frage: "Darf ich dich nach dem Umzug per WhatsApp um eine Google-Bewertung bitten?",
    hinweis: "Freiwillig und ohne Einfluss auf deinen Auftrag. Abmelden geht jederzeit mit STOP.",
  },
  sie: {
    frage: "Darf ich Sie nach dem Umzug per WhatsApp um eine Google-Bewertung bitten?",
    hinweis: "Freiwillig und ohne Einfluss auf Ihren Auftrag. Abmelden geht jederzeit mit STOP.",
  },
};

/** Anrede im Portal: Sie bei Ceylan, du bei Kottke. */
export function portalAnrede(marke: ManuellMarke): ManuellAnrede {
  return marke === "ceylan" ? "sie" : "du";
}

/** Gespeicherter Wortlaut: Frage und Hinweis, wie der Kunde sie sah, mit Quelle. */
export function einwilligungsWortlaut(anrede: ManuellAnrede): string {
  const t = EINWILLIGUNG_PORTAL[anrede];
  return `Portal, Annahme des Angebots: „${t.frage}“ angehakt. ${t.hinweis}`;
}

/** Nur ein ausdrückliches `true` zählt; fehlend, falsch oder anders getippt heißt nein. */
export function bewertungEinwilligungAus(raw: unknown): boolean {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
  return (raw as Record<string, unknown>).bewertungEinwilligung === true;
}

// ─── Kunden ───────────────────────────────────────────────────────────────────

/** Kunde ist, wer mindestens einen angenommenen, durchgeführten oder bezahlten Auftrag hat (Übersicht K1). */
export const KUNDEN_STUFEN: readonly StageCategory[] = ["booked", "done_unpaid", "paid"];
/** Diese Kontaktarten sind nie Kunde und nie Anfrage. */
export const KONTAKTART_NIE: readonly Kontaktart[] = ["bewerber", "team_helfer", "spam_werbung"];

export type KundenArt = "kunde" | "anfrage" | "nie";

export function kundenArt(p: {
  kontaktart: Kontaktart | null;
  dealKategorien: (StageCategory | null)[];
  /** Es gibt eine aktive Annahme (`kva_confirmations` ohne Widerruf) an einem Deal der Person. */
  aktiveAnnahme: boolean;
}): KundenArt {
  if (p.kontaktart && KONTAKTART_NIE.includes(p.kontaktart)) return "nie";
  if (p.aktiveAnnahme || p.dealKategorien.some((k) => !!k && KUNDEN_STUFEN.includes(k))) return "kunde";
  return "anfrage";
}

/** Wiederkehrer: mindestens zwei Aufträge in Kundenstufen. */
export function istWiederkehrer(dealKategorien: (StageCategory | null)[]): boolean {
  return dealKategorien.filter((k) => !!k && KUNDEN_STUFEN.includes(k)).length >= 2;
}

export type KundenSuche =
  | { art: "leer" }
  | { art: "telefon"; e164: string }
  | { art: "dealnummer"; nummer: string }
  | { art: "email"; text: string }
  | { art: "name"; text: string };

const DEALNUMMER = /^\d{4}-\d{1,5}$/;
const MIN_NAME = 2;
const MAX_SUCHE = 100;

/**
 * Was der Nutzer tippt: Deal-Nummer „2026-014“, Telefon in jeder Schreibweise
 * (→ E.164 wie `person_identifiers.value_canonical`), E-Mail, sonst Name.
 */
export function kundenSuche(eingabe: string): KundenSuche {
  const q = eingabe.trim().slice(0, MAX_SUCHE);
  if (q.length < MIN_NAME) return { art: "leer" };
  if (DEALNUMMER.test(q)) return { art: "dealnummer", nummer: q };
  if (q.includes("@")) return { art: "email", text: q.toLowerCase() };
  const ziffern = q.replace(/[^\d]/g, "");
  if (/^[\d\s+()\/.-]+$/.test(q) && ziffern.length >= 6) {
    const e164 = canonicalizePhone(q, "DE");
    if (e164) return { art: "telefon", e164 };
  }
  return { art: "name", text: q };
}

/** Schlüssel für den Dubletten-Hinweis: Kleinbuchstaben, ohne Akzente und Satzzeichen, Wörter sortiert. */
export function dublettenSchluessel(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1)
    .sort()
    .join(" ");
}

export type FirmaKurz = { id: string; name: string; marke: ManuellMarke | null };

export interface KundenZeile {
  personId: string;
  name: string;
  telefon: string | null;
  firmen: FirmaKurz[];
  auftraege: number;
  letzterUmzug: string | null;
  offenCent: number | null;
  wiederkehrer: boolean;
  dublette: boolean;
}

export interface KundenUmzug {
  dealId: string;
  dealNummer: string | null;
  titel: string;
  stufe: { label: string; kategorie: StageCategory | null };
  umzugsdatum: string | null;
  firma: FirmaKurz | null;
  gesamtCent: number | null;
  offenCent: number | null;
  bewertung: BewertungListe | null;
}

export interface KundenGespraech {
  conversationId: string;
  kanal: "whatsapp" | "email" | "sms" | "andere";
  konto: string;
  firma: FirmaKurz | null;
  letzteNachrichtAm: string | null;
  dealId: string | null;
}

export interface KundenAkte {
  personId: string;
  name: string;
  kontaktart: Kontaktart | null;
  art: KundenArt;
  telefone: string[];
  emails: string[];
  firmen: FirmaKurz[];
  mehrfachFirma: boolean;
  wiederkehrer: boolean;
  bewertungGesperrt: boolean;
  umzuege: KundenUmzug[];
  /** Summe der offenen Reste; null, wenn kein Umzug einen bekannten Rest hat (Stunden-KV). */
  offenCent: number | null;
  /** Gespräche je Firma gruppiert, neueste zuerst. */
  gespraeche: { firma: FirmaKurz | null; liste: KundenGespraech[] }[];
  dubletten: { personId: string; name: string; grund: "vorschlag" | "gleicher_name" }[];
}

/** Summe der bekannten Reste; nur null, wenn kein Umzug einen Rest hat. */
export function offenSumme(reste: (number | null)[]): number | null {
  const bekannt = reste.filter((r): r is number => typeof r === "number");
  return bekannt.length === 0 ? null : bekannt.reduce((a, b) => a + b, 0);
}

/** Gespräche nach Firma gruppieren (Firma des Kanalkontos), ohne Firma zuletzt. */
export function gespraecheJeFirma(liste: KundenGespraech[]): KundenAkte["gespraeche"] {
  const gruppen = new Map<string, { firma: FirmaKurz | null; liste: KundenGespraech[] }>();
  for (const g of liste) {
    const key = g.firma?.id ?? "";
    const gruppe = gruppen.get(key) ?? { firma: g.firma, liste: [] };
    gruppe.liste.push(g);
    gruppen.set(key, gruppe);
  }
  const zeit = (g: KundenGespraech) => (g.letzteNachrichtAm ? Date.parse(g.letzteNachrichtAm) : 0);
  return [...gruppen.values()]
    .map((gr) => ({ ...gr, liste: [...gr.liste].sort((a, b) => zeit(b) - zeit(a)) }))
    .sort((a, b) => (a.firma ? 0 : 1) - (b.firma ? 0 : 1) || (a.firma?.name ?? "").localeCompare(b.firma?.name ?? "", "de"));
}

// ─── Antworten der Routen (Server und Oberfläche teilen sie) ─────────────────

/** Eine Zeile der Arbeitsliste. Zeiten als ISO-Text. */
export interface BewertungZeile {
  dealId: string;
  dealNummer: string | null;
  titel: string;
  kunde: { personId: string; name: string } | null;
  firma: FirmaKurz | null;
  liste: BewertungListe;
  grund: SperrGrund | null;
  /** Vormerkung: nächster Sendezeitpunkt; fällig: Zeitpunkt der Berechtigung. */
  faelligAb: string | null;
  angefragtAm: string | null;
  geklicktAm: string | null;
  quelle: TokenQuelle | VormerkungArt | null;
  vormerkungId: string | null;
  tokenFreigebbar: boolean;
}

export interface BewertungFirma extends FirmaKurz {
  modus: BewertungModus;
  modusSeit: string | null;
  googleLink: boolean;
}

/** GET /api/v1/bewertungen?firma=&liste= */
export interface BewertungenAntwort {
  firmen: BewertungFirma[];
  zeilen: BewertungZeile[];
  zaehler: Record<BewertungListe, number>;
  /** Deals mit `do_not_contact_review` aus dem Backfill (vor `BACKFILL_STICHTAG`): nur Zahl, keine Zeilen. */
  altsperren: number;
}

export const KUNDEN_ANSICHTEN = ["kunden", "anfragen", "ohne_kunde"] as const;
export type KundenAnsicht = (typeof KUNDEN_ANSICHTEN)[number];

export interface DealOhneKunde {
  dealId: string;
  dealNummer: string | null;
  titel: string;
  stufe: { label: string; kategorie: StageCategory | null };
  firma: FirmaKurz | null;
  angelegtAm: string;
}

/** GET /api/v1/kunden?ansicht=&q=&vor= */
export interface KundenListeAntwort {
  ansicht: KundenAnsicht;
  suche: KundenSuche["art"];
  zeilen: KundenZeile[];
  ohneKunde: DealOhneKunde[];
  /** Cursor für „mehr laden“ (personId bzw. dealId der letzten Zeile), null am Ende. */
  weiter: string | null;
}

export const KUNDEN_SEITE = 50;
