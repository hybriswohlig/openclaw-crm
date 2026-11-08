/**
 * Plan 9 „Geld“, Vertrag (Meilenstein 3). Rein: keine DB, kein Netz, keine Uhr
 * außer übergebenen Werten. Ziel im Repo: `apps/web/src/lib/geld.ts`.
 *
 * Inhalt: Rechnung als Datensatz (Nummer, Fälligkeit, Prüfung vor dem Speichern),
 * ein einziger Begriff „offen“ (`offenAus`), Abschluss und `bezahlt_am`,
 * Zahlung stornieren und korrigieren, Alarm „Kunde meldet bezahlt“, Kasse,
 * Tagesabschluss, Stunden-Vorschlag, Zahlungserinnerung samt Kundentexten.
 */
import type { StundenAngebot } from "@/lib/angebot-wahl";
import type { Zahlungsart } from "@/lib/zahlungsart";
import {
  MELDUNG_BESTAETIGT,
  MELDUNG_GEMELDET,
  MELDUNG_VERWORFEN,
  type Meldungsvariante,
  type Zahlungsmeldung,
} from "@/lib/zahlungsmeldungen";

// ─── Grundtypen ─────────────────────────────────────────────────────────────

export const RECHNUNG_STATUS = ["entwurf", "gestellt", "storniert", "verworfen"] as const;
export type RechnungStatus = (typeof RECHNUNG_STATUS)[number];

export const RECHNUNG_HERKUNFT = ["crm", "vps", "upload", "alt"] as const;
export type RechnungHerkunft = (typeof RECHNUNG_HERKUNFT)[number];

/** `payments.quelle`; Altzeilen `null`. */
export const ZAHLUNG_QUELLEN = ["hand", "meldung", "mitarbeiter", "api", "storno"] as const;
export type ZahlungQuelle = (typeof ZAHLUNG_QUELLEN)[number];

/** Stufen-Kategorien, die Plan 9 unterscheidet (`statuses.stage_category`). */
export type GeldKategorie = "booked" | "done_unpaid" | "paid" | "lost" | string;

/** Eine Zeile `deal_invoices` (Migration 0062). Tage als `YYYY-MM-DD`, Zeitpunkte ISO. */
export interface RechnungZeile {
  id: string;
  workspaceId: string;
  dealRecordId: string;
  operatingCompanyId: string | null;
  nummer: string | null;
  jahr: number | null;
  laufnummer: number | null;
  herkunft: RechnungHerkunft;
  status: RechnungStatus;
  bruttoCent: number | null;
  rechnungstag: string | null;
  faelligAm: string | null;
  abweichungGrund: string | null;
  dealDocumentId: string | null;
  renderJobId: string | null;
  stornoGrund: string | null;
  storniertAm: string | null;
  storniertVon: string | null;
  verworfenGrund: string | null;
  createdBy: string | null;
  createdAt: string;
}

/** Stand der Erinnerung zu einer Rechnung (`payment_reminders`). */
export type ErinnerungStatus = "entwurf" | "gesendet" | "verworfen" | "gestoppt";
export interface ErinnerungStand {
  stufe: 1 | 2;
  status: ErinnerungStatus;
  /** Anlage (entwurf) bzw. Versand (gesendet), ISO. */
  am: string;
}

/** Was Akte, Kasse und Heute von einer Rechnung zeigen. */
export interface RechnungKurz {
  id: string;
  nummer: string | null;
  status: RechnungStatus;
  bruttoCent: number | null;
  rechnungstag: string | null;
  faelligAm: string | null;
  abweichungGrund: string | null;
  erinnerung: ErinnerungStand | null;
}

/** Was der Mensch beim Rechnungsschritt bestätigt (Body `rechnung`, VPS-Parameter `_rechnung`). */
export interface RechnungEingabe {
  bruttoCent?: number | null;
  abweichungGrund?: string | null;
  /** Ausdrückliches Fälligkeitsdatum (API, MCP); gewinnt gegen die Firmenregel. */
  faelligAm?: string | null;
}

// ─── Fehler ─────────────────────────────────────────────────────────────────

export type GeldFehlerCode =
  | "FIRMA_FEHLT"
  | "AKTIVE_RECHNUNG"
  | "RECHNUNG_WEICHT_AB"
  | "RECHNUNG_PDF_ANDERS"
  | "STUNDEN_BETRAG_FEHLT"
  | "BETRAG_FEHLT"
  | "NUR_MENSCH"
  | "NUR_STORNO"
  | "SCHON_STORNIERT"
  | "NUR_KORREKTUR"
  | "GRUND_FEHLT";

/** HTTP-Status je Code: 409 Zustand, 400 Eingabe, 403 Recht. */
export const GELD_FEHLER_STATUS: Record<GeldFehlerCode, 400 | 403 | 409> = {
  FIRMA_FEHLT: 409,
  AKTIVE_RECHNUNG: 409,
  RECHNUNG_WEICHT_AB: 409,
  RECHNUNG_PDF_ANDERS: 409,
  STUNDEN_BETRAG_FEHLT: 409,
  BETRAG_FEHLT: 409,
  NUR_MENSCH: 403,
  NUR_STORNO: 409,
  SCHON_STORNIERT: 409,
  NUR_KORREKTUR: 409,
  GRUND_FEHLT: 400,
};

/** Texte für das Team (nicht für Kunden). */
export const GELD_FEHLER_TEXT: Record<GeldFehlerCode, string> = {
  FIRMA_FEHLT: "Der Auftrag hat keine Firma. Bitte zuerst Kottke oder Ceylan setzen.",
  AKTIVE_RECHNUNG: "Für diesen Auftrag gibt es schon eine Rechnung. Für eine neue bitte die alte stornieren.",
  RECHNUNG_WEICHT_AB:
    "Die Rechnung weicht vom angenommenen Betrag ab. Bitte im Rechnungsschritt der Akte einen Grund angeben.",
  RECHNUNG_PDF_ANDERS: "Der bestätigte Betrag passt nicht zum Betrag im PDF. Bitte das Angebot prüfen.",
  STUNDEN_BETRAG_FEHLT: "Stunden-KV: bitte den Rechnungsbetrag im Rechnungsschritt der Akte bestätigen.",
  BETRAG_FEHLT: "Für die Rechnung fehlt ein Betrag.",
  NUR_MENSCH: "Diese Rechnung kann nur ein Mensch erstellen.",
  NUR_STORNO: "Gestellte Rechnungen und Zahlungen mit Belegnummer werden storniert, nicht gelöscht.",
  SCHON_STORNIERT: "Das ist schon storniert.",
  NUR_KORREKTUR: "Betrag und Kaution ändern sich nur über „Korrigieren“ (Storno und neue Zahlung).",
  GRUND_FEHLT: "Bitte einen Grund angeben.",
};

export class GeldFehler extends Error {
  readonly code: GeldFehlerCode;
  readonly status: 400 | 403 | 409;
  constructor(code: GeldFehlerCode, text: string = GELD_FEHLER_TEXT[code]) {
    super(text);
    this.name = "GeldFehler";
    this.code = code;
    this.status = GELD_FEHLER_STATUS[code];
  }
}

/** Mindestlänge eines Grundes (Abweichung, Storno). */
export const GRUND_MIN_ZEICHEN = 5;

export function grundGueltig(grund: string | null | undefined): string | null {
  const g = (grund ?? "").trim();
  return g.length >= GRUND_MIN_ZEICHEN ? g : null;
}

// ─── Tage ───────────────────────────────────────────────────────────────────

const TAG = /^(\d{4})-(\d{2})-(\d{2})$/;

/** `YYYY-MM-DD` plus n Tage (UTC-Arithmetik, keine Zeitzone im Spiel). */
export function tagPlusTage(tag: string, n: number): string {
  const m = TAG.exec(tag);
  if (!m) throw new Error(`Ungültiger Tag: ${tag}`);
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + n));
  return d.toISOString().slice(0, 10);
}

/** Berliner Kalendertag eines Zeitpunkts. */
export function berlinTag(iso: string | Date): string {
  const d = iso instanceof Date ? iso : new Date(iso);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Berlin",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

// ─── Firmenregel (company_settings, Plan 13 hängt die Oberfläche dran) ─────

export interface FirmenZahlungsregel {
  /** Worauf das Zahlungsziel aufsetzt (G1: Rest fällig am Umzugstag). */
  basis: "umzugstag" | "rechnungstag";
  /** Tage nach der Basis, 0 bis 60. */
  tage: number;
  /** G2: zuerst nur Entwurf zur Freigabe; Standard aus. */
  erinnerungModus: "aus" | "entwurf";
  /** Erste Erinnerung frühestens so viele Tage nach Fälligkeit (1 bis 60). */
  erinnerungTage: number;
  /** Zweite Erinnerung so viele Tage nach dem Versand der ersten (1 bis 60). */
  erinnerung2Tage: number;
}

export const ZAHLUNGSREGEL_STANDARD: FirmenZahlungsregel = {
  basis: "umzugstag",
  tage: 0,
  erinnerungModus: "aus",
  erinnerungTage: 7,
  erinnerung2Tage: 14,
};

function ganzzahlIn(wert: unknown, von: number, bis: number, feld: string): number {
  if (typeof wert !== "number" || !Number.isInteger(wert) || wert < von || wert > bis) {
    throw new Error(`${feld} muss eine ganze Zahl von ${von} bis ${bis} sein.`);
  }
  return wert;
}

/** Prüft einen Patch aus `PATCH /api/v1/company-settings/[ocId]` (`zahlung`). Wirft mit Text. */
export function pruefeZahlungsregel(patch: unknown): Partial<FirmenZahlungsregel> {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
    throw new Error("zahlung muss ein Objekt sein.");
  }
  const p = patch as Record<string, unknown>;
  const out: Partial<FirmenZahlungsregel> = {};
  for (const k of Object.keys(p)) {
    if (!["basis", "tage", "erinnerungModus", "erinnerungTage", "erinnerung2Tage"].includes(k)) {
      throw new Error(`Unbekanntes Feld zahlung.${k}.`);
    }
  }
  if (p.basis !== undefined) {
    if (p.basis !== "umzugstag" && p.basis !== "rechnungstag") throw new Error("basis: umzugstag oder rechnungstag.");
    out.basis = p.basis;
  }
  if (p.tage !== undefined) out.tage = ganzzahlIn(p.tage, 0, 60, "tage");
  if (p.erinnerungModus !== undefined) {
    if (p.erinnerungModus !== "aus" && p.erinnerungModus !== "entwurf") {
      throw new Error("erinnerungModus: aus oder entwurf.");
    }
    out.erinnerungModus = p.erinnerungModus;
  }
  if (p.erinnerungTage !== undefined) out.erinnerungTage = ganzzahlIn(p.erinnerungTage, 1, 60, "erinnerungTage");
  if (p.erinnerung2Tage !== undefined) out.erinnerung2Tage = ganzzahlIn(p.erinnerung2Tage, 1, 60, "erinnerung2Tage");
  return out;
}

/** Höchstlänge der Steuernummer (Briefkopf). */
export const STEUERNUMMER_MAX = 40;

/** Leer → null; sonst getrimmt, höchstens 40 Zeichen. Wirft mit Text. */
export function pruefeSteuernummer(wert: unknown): string | null {
  if (wert === null || wert === undefined) return null;
  if (typeof wert !== "string") throw new Error("steuernummer muss Text oder leer sein.");
  const t = wert.trim();
  if (!t) return null;
  if (t.length > STEUERNUMMER_MAX) throw new Error(`steuernummer: höchstens ${STEUERNUMMER_MAX} Zeichen.`);
  return t;
}

// ─── Nummer und Fälligkeit ──────────────────────────────────────────────────

/** `RE-2026-0001`: je Firma und Berliner Jahr fortlaufend. */
export function rechnungsNummer(jahr: number, laufnummer: number): string {
  if (!Number.isInteger(jahr) || !Number.isInteger(laufnummer) || laufnummer < 1) {
    throw new Error("Ungültige Rechnungsnummer.");
  }
  return `RE-${jahr}-${String(laufnummer).padStart(4, "0")}`;
}

/** Dateistamm des PDFs aus dem CRM-Renderer: `RE-2026-0001-ceylan`. */
export function rechnungsDateiStamm(nummer: string, firma: string): string {
  return `${nummer}-${firma}`;
}

/**
 * Fälligkeit (G1). Basis Umzugstag (ohne Umzugstag: Rechnungstag) oder
 * Rechnungstag, plus `tage`; nie vor dem Rechnungstag. Ein ausdrückliches
 * Datum gewinnt, auch wenn es vor dem Rechnungstag liegt (API wie heute).
 */
export function faelligAm(e: {
  rechnungstag: string;
  umzugstag: string | null;
  regel: Pick<FirmenZahlungsregel, "basis" | "tage">;
  ausdruecklich?: string | null;
}): string {
  if (e.ausdruecklich && TAG.test(e.ausdruecklich)) return e.ausdruecklich;
  const basis = e.regel.basis === "umzugstag" && e.umzugstag && TAG.test(e.umzugstag) ? e.umzugstag : e.rechnungstag;
  const tag = tagPlusTage(basis, e.regel.tage);
  return tag < e.rechnungstag ? e.rechnungstag : tag;
}

// ─── Ein Begriff „offen“ ────────────────────────────────────────────────────

export type OffenQuelle = "rechnung" | "annahme" | "angebot" | "stunden" | "keins";

export interface OffenErgebnis {
  gesamtCent: number | null;
  bezahltCent: number;
  /** null = Betrag unbekannt (Stunden-KV ohne Rechnungsbetrag, kein Angebot). */
  restCent: number | null;
  quelle: OffenQuelle;
}

export interface OffenEingabe {
  /** Aktive Rechnung des Deals; nur `gestellt` mit Betrag zählt. */
  rechnung: { status: RechnungStatus; bruttoCent: number | null } | null;
  annahmeCent: number | null;
  festpreis: string | null;
  istStunden: boolean;
  /** Alle Zahlungen des Deals, Gegenbuchungen (negativ) eingeschlossen. */
  zahlungen: { amount: string | number | null; taxTreatment: string | null }[];
}

function bezahltCentAus(zahlungen: OffenEingabe["zahlungen"]): number {
  // Wie preisZahlungenCent: Kaution, durchlaufende Posten, Erstattung zählen nicht.
  return zahlungen.reduce((s, z) => {
    if (z.taxTreatment === "nicht_steuerbar") return s;
    const c = Math.round(Number(z.amount) * 100);
    return Number.isFinite(c) ? s + c : s;
  }, 0);
}

function euroText(festpreis: string | null): number | null {
  if (festpreis == null || festpreis.trim() === "") return null;
  const e = Number(festpreis.trim());
  return Number.isFinite(e) ? Math.round(e * 100) : null;
}

/**
 * Der eine offene Rest. Reihenfolge: gestellte Rechnung mit Betrag, sonst
 * Stunden-KV (unbekannt), sonst aktive Annahme, sonst Festpreis.
 */
export function offenAus(e: OffenEingabe): OffenErgebnis {
  const bezahltCent = bezahltCentAus(e.zahlungen);
  const mit = (gesamtCent: number, quelle: OffenQuelle): OffenErgebnis => ({
    gesamtCent,
    bezahltCent,
    restCent: Math.max(0, gesamtCent - bezahltCent),
    quelle,
  });
  if (e.rechnung && e.rechnung.status === "gestellt" && e.rechnung.bruttoCent != null) {
    return mit(e.rechnung.bruttoCent, "rechnung");
  }
  if (e.istStunden) return { gesamtCent: null, bezahltCent, restCent: null, quelle: "stunden" };
  if (e.annahmeCent != null) return mit(e.annahmeCent, "annahme");
  const fest = euroText(e.festpreis);
  if (fest == null) return { gesamtCent: null, bezahltCent, restCent: null, quelle: "keins" };
  return mit(fest, "angebot");
}

// ─── Prüfung vor jeder Rechnung ─────────────────────────────────────────────

export interface RechnungsPruefungEingabe {
  firmaId: string | null;
  aktiveRechnung: boolean;
  istStunden: boolean;
  annahmeCent: number | null;
  festpreisCent: number | null;
  /** Was das PDF druckt (CRM: `model.totalCents`, VPS: `quotationTotalCents`); Upload: null. */
  pdfBetragCent: number | null;
  eingabe: RechnungEingabe | null;
  durchAgent: boolean;
}

export type RechnungsPruefung =
  | { ok: true; bruttoCent: number; abweichungGrund: string | null }
  | { ok: false; code: GeldFehlerCode };

/** Entscheidung 4 und G8. */
export function rechnungsPruefung(e: RechnungsPruefungEingabe): RechnungsPruefung {
  if (!e.firmaId) return { ok: false, code: "FIRMA_FEHLT" };
  if (e.aktiveRechnung) return { ok: false, code: "AKTIVE_RECHNUNG" };
  const bestaetigt = e.eingabe?.bruttoCent ?? null;
  if (bestaetigt != null && (!Number.isInteger(bestaetigt) || bestaetigt < 0)) return { ok: false, code: "BETRAG_FEHLT" };
  const grund = grundGueltig(e.eingabe?.abweichungGrund);

  if (e.istStunden) {
    if (e.durchAgent) return { ok: false, code: "NUR_MENSCH" };
    if (bestaetigt == null || bestaetigt <= 0) return { ok: false, code: "STUNDEN_BETRAG_FEHLT" };
    return { ok: true, bruttoCent: bestaetigt, abweichungGrund: grund };
  }

  if (e.pdfBetragCent != null && bestaetigt != null && bestaetigt !== e.pdfBetragCent) {
    return { ok: false, code: "RECHNUNG_PDF_ANDERS" };
  }
  const betrag = e.pdfBetragCent ?? bestaetigt ?? e.annahmeCent ?? e.festpreisCent;
  if (betrag == null || betrag <= 0) return { ok: false, code: "BETRAG_FEHLT" };
  if (e.annahmeCent != null && betrag !== e.annahmeCent) {
    if (e.durchAgent) return { ok: false, code: "NUR_MENSCH" };
    if (!grund) return { ok: false, code: "RECHNUNG_WEICHT_AB" };
    return { ok: true, bruttoCent: betrag, abweichungGrund: grund };
  }
  return { ok: true, bruttoCent: betrag, abweichungGrund: null };
}

// ─── Stunden-KV: Vorschlag aus gestempelten Stunden ─────────────────────────

export interface ZeitEintrag {
  employeeId: string;
  startAt: string;
  endAt: string | null;
  breakMinutes: number;
  status: "open" | "submitted" | "approved" | string;
}

export interface StundenVorschlag {
  bruttoCent: number | null;
  /** Abgerechnete Stunden (halbe Stunden aufgerundet, mindestens Mindeststunden). */
  stunden: number;
  helfer: number;
  transporter: number;
  /** „3 Helfer, 5,5 Std., 1 Transporter“ oder Grund, warum kein Betrag. */
  grundlage: string;
  /** Einträge noch ohne Ende oder nicht eingereicht. */
  offeneEintraege: number;
}

function zahlDe(n: number): string {
  return new Intl.NumberFormat("de-DE", { maximumFractionDigits: 1 }).format(n);
}

/**
 * Vorschlag für den Rechnungsbetrag (Entscheidung 17). Zählt nur Einträge mit
 * Status `submitted` oder `approved` und Ende. Stunden = längste Zeit einer
 * Person, auf halbe Stunden aufgerundet, mindestens `mindestStunden`.
 * Betrag = Stunden × (Helfer × Satz + Transporter × Satz). Ohne Sätze aus der
 * Version oder ohne Einträge: kein Betrag, der Mensch trägt ihn ein.
 */
export function stundenVorschlag(e: { eintraege: ZeitEintrag[]; stunden: StundenAngebot | null }): StundenVorschlag {
  const minuten = new Map<string, number>();
  let offen = 0;
  for (const z of e.eintraege) {
    if ((z.status !== "submitted" && z.status !== "approved") || !z.endAt) {
      offen += 1;
      continue;
    }
    const dauer = (Date.parse(z.endAt) - Date.parse(z.startAt)) / 60_000 - Math.max(0, z.breakMinutes);
    if (!Number.isFinite(dauer) || dauer <= 0) continue;
    minuten.set(z.employeeId, (minuten.get(z.employeeId) ?? 0) + dauer);
  }
  const s = e.stunden;
  const transporter = s?.transporter ?? 0;
  if (minuten.size === 0) {
    return { bruttoCent: null, stunden: 0, helfer: 0, transporter, grundlage: "Keine eingereichten Stunden.", offeneEintraege: offen };
  }
  const helfer = minuten.size;
  const laengste = Math.max(...minuten.values()) / 60;
  const gerundet = Math.ceil(laengste * 2) / 2;
  const stunden = Math.max(gerundet, s?.mindestStunden ?? 0);
  const grundlage = `${helfer} Helfer, ${zahlDe(stunden)} Std., ${transporter} Transporter`;
  if (!s) {
    return { bruttoCent: null, stunden, helfer, transporter, grundlage: `${grundlage}; Sätze fehlen, Betrag bitte eintragen.`, offeneEintraege: offen };
  }
  const bruttoCent = Math.round(stunden * (helfer * s.satzHelferEur + transporter * s.satzTransporterEur) * 100);
  return { bruttoCent, stunden, helfer, transporter, grundlage, offeneEintraege: offen };
}

/** `preise` für den VPS bei einer Stunden-Rechnung: eine Pauschale mit dem bestätigten Betrag. */
export function stundenPreiseFuerVps(firma: string, bruttoCent: number, grundlage: string): Record<string, unknown> {
  const betrag = bruttoCent / 100;
  if (firma === "ceylan") return { modell: "pauschale", pauschale_betrag: betrag };
  return { modell: "pauschale", pauschale_positionen: [{ titel: `Umzug nach Aufwand (${grundlage})`, betrag }] };
}

export interface RechnungsVorschlag {
  istStunden: boolean;
  annahmeCent: number | null;
  /** Was das PDF heute drucken würde (Festpreis); Stunden: null. */
  pdfBetragCent: number | null;
  /** Vorbelegung des Betrags. */
  bruttoCent: number | null;
  /** PDF-Betrag weicht von der Annahme ab: Grund ist Pflicht. */
  abweichung: boolean;
  stunden: StundenVorschlag | null;
  /** Vorschau nach Firmenregel mit heutigem Rechnungstag. */
  faelligAm: string;
  aktiveRechnung: RechnungKurz | null;
  /** Gesetzt, wenn ohne Eingriff keine Rechnung möglich ist (`FIRMA_FEHLT`, `AKTIVE_RECHNUNG`). */
  sperrgrund: GeldFehlerCode | null;
}

// ─── Abschluss und bezahlt_am ───────────────────────────────────────────────

export interface AbschlussEntscheidung {
  bezahltAmSetzen: boolean;
  bezahltAmLeeren: boolean;
  /** Durchgeführt → Bezahlt (nur vorwärts, nur mit Rechnung). */
  stufeBezahlt: boolean;
}

/** Entscheidung 11. */
export function abschlussAus(e: {
  restCent: number | null;
  rechnungGestellt: boolean;
  bezahltAm: string | null;
  kategorie: GeldKategorie | null;
}): AbschlussEntscheidung {
  const voll = e.restCent === 0 && e.rechnungGestellt;
  return {
    bezahltAmSetzen: voll && e.bezahltAm == null,
    bezahltAmLeeren: e.bezahltAm != null && e.restCent != null && e.restCent > 0,
    stufeBezahlt: voll && e.kategorie === "done_unpaid",
  };
}

// ─── Zahlung stornieren und korrigieren ─────────────────────────────────────

export interface ZahlungStornoQuelle {
  id: string;
  dealRecordId: string | null;
  operatingCompanyId: string | null;
  amount: string;
  paymentMethod: string | null;
  taxTreatment: string;
  quelle: ZahlungQuelle | null;
  stornoVonPaymentId: string | null;
}

/** Ob eine Zahlung storniert werden darf; `hatStorno` = es gibt schon eine Gegenbuchung. */
export function stornierbar(z: ZahlungStornoQuelle, hatStorno: boolean): GeldFehlerCode | null {
  if (z.quelle === "storno" || z.stornoVonPaymentId != null || hatStorno) return "SCHON_STORNIERT";
  return null;
}

/** Werte der Gegenbuchung (Belegnummer vergibt der Dienst). */
export function zahlungStornoWerte(z: ZahlungStornoQuelle, grund: string, heute: string) {
  const g = grundGueltig(grund);
  if (!g) throw new GeldFehler("GRUND_FEHLT");
  const cent = Math.round(Number(z.amount) * 100);
  if (!Number.isFinite(cent)) throw new Error("Ungültiger Betrag.");
  return {
    dealRecordId: z.dealRecordId,
    operatingCompanyId: z.operatingCompanyId,
    date: heute,
    amount: (-cent / 100).toFixed(2),
    paymentMethod: z.paymentMethod,
    taxTreatment: z.taxTreatment,
    quelle: "storno" as const,
    stornoVonPaymentId: z.id,
    stornoGrund: g,
    notes: `Storno: ${g}`,
  };
}

export interface ZahlungKorrektur {
  date: string;
  amountCent: number;
  paymentMethod: Zahlungsart;
  kaution: boolean;
  notes?: string | null;
  grund: string;
}

/** Felder, die „Bearbeiten“ ändern darf; Betrag und Kaution nur über „Korrigieren“. */
export const ZAHLUNG_BEARBEITBAR = ["date", "paymentMethod", "payer", "notes"] as const;

export function zahlungAenderung(
  vorher: { amount: string; taxTreatment: string },
  patch: Record<string, unknown>
): { code: GeldFehlerCode | null; felder: string[] } {
  const felder = Object.keys(patch);
  const betragAnders = patch.amount !== undefined && Math.round(Number(patch.amount) * 100) !== Math.round(Number(vorher.amount) * 100);
  const kautionAnders = patch.taxTreatment !== undefined && patch.taxTreatment !== vorher.taxTreatment;
  if (betragAnders || kautionAnders) return { code: "NUR_KORREKTUR", felder };
  return { code: null, felder: felder.filter((f) => (ZAHLUNG_BEARBEITBAR as readonly string[]).includes(f)) };
}

// ─── Alarm „Kunde meldet bezahlt“ ───────────────────────────────────────────

export const MELDUNG_ALARM = "payment.meldung_alarm";

type Ereignis = { id: string; eventType: string; payload: unknown; createdAt: Date | string };
const zeit = (d: Date | string) => (d instanceof Date ? d : new Date(d)).getTime();

/**
 * Genau ein Alarm je Meldung (G7): fällig, wenn seit der letzten Erledigung
 * (bestätigt oder verworfen) dieser Variante noch kein Alarm derselben
 * Variante liegt. `ereignisse` enthält die drei Meldungstypen und `MELDUNG_ALARM`.
 */
export function meldungsAlarmFaellig(ereignisse: Ereignis[], eventId: string): boolean {
  const meldung = ereignisse.find((e) => e.id === eventId && e.eventType === MELDUNG_GEMELDET);
  if (!meldung) return false;
  const variante = (meldung.payload as { variant?: unknown } | null)?.variant;
  if (variante !== "deposit" && variante !== "final") return false;
  const p = (e: Ereignis) => (e.payload ?? {}) as Record<string, unknown>;
  const letzteFolge = ereignisse
    .filter((e) => (e.eventType === MELDUNG_BESTAETIGT || e.eventType === MELDUNG_VERWORFEN) && p(e).variante === variante)
    .reduce((m, e) => Math.max(m, zeit(e.createdAt)), -Infinity);
  return !ereignisse.some(
    (e) => e.eventType === MELDUNG_ALARM && p(e).variante === variante && zeit(e.createdAt) > letzteFolge
  );
}

export function euro(cent: number): string {
  return new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(cent / 100);
}

export function tagDe(tag: string): string {
  const m = TAG.exec(tag);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : tag;
}

/** Interne WhatsApp an beide Inhaber. */
export function meldungsAlarmText(e: {
  name: string;
  nummer: string | null;
  betragCent: number;
  variante: Meldungsvariante;
}): string {
  const art = e.variante === "deposit" ? "Anzahlung" : "Restzahlung";
  const auftrag = e.nummer ? `, Auftrag ${e.nummer}` : "";
  return `Kunde meldet bezahlt: ${e.name}${auftrag}, ${art} ${euro(e.betragCent)}. Bitte nach dem Zahlungseingang in der Kasse bestätigen.`;
}

// ─── Kasse ──────────────────────────────────────────────────────────────────

export const KASSE_SCHLANGEN = ["meldung", "ohne_rechnung", "offen", "anzahlung"] as const;
export type KasseSchlange = (typeof KASSE_SCHLANGEN)[number];

export const KASSE_TITEL: Record<KasseSchlange, string> = {
  meldung: "Kunde meldet bezahlt",
  ohne_rechnung: "Durchgeführt ohne Rechnung",
  offen: "Offener Rest",
  anzahlung: "Anzahlung fehlt",
};

/** So viele Tage voraus zählt „Anzahlung fehlt“. */
export const ANZAHLUNG_VORAUS_TAGE = 14;

/** Ein Deal, wie `services/kasse.ts` ihn aus `ladeLeadsRoh` und `deal_invoices` baut. */
export interface KasseDealRoh {
  dealId: string;
  name: string;
  nummer: string | null;
  firmaId: string | null;
  firmaName: string | null;
  kategorie: GeldKategorie | null;
  /** Fester Termin (erster Tag), `YYYY-MM-DD`. */
  termin: string | null;
  /** Letzter Termintag bzw. Tag des Wechsels auf Durchgeführt. */
  durchgefuehrtAm: string | null;
  offen: OffenErgebnis;
  rechnung: RechnungKurz | null;
  meldungen: Zahlungsmeldung[];
  anzahlungCent: number | null;
  regel: FirmenZahlungsregel;
  /** Erinnerung wäre fällig, aber es gibt keinen Kanal. */
  kanalFehlt: boolean;
}

export interface KasseZeile {
  dealId: string;
  name: string;
  nummer: string | null;
  firmaName: string | null;
  betragCent: number | null;
  /** „fällig 12.11.“, „überfällig seit 19.11.“, „Termin Sa 21.11.“, „Erinnerung 1 gesendet 26.11.“ */
  text: string;
  /** Sortierung und „seit“, `YYYY-MM-DD`. */
  seit: string | null;
  href: string;
  gold: boolean;
  /** Fälligkeit plus Erinnerungsfrist erreicht (zählt in der Seitenleiste). */
  mahnreif: boolean;
}

export interface KasseAntwort {
  schlangen: Record<KasseSchlange, KasseZeile[]>;
  summen: Record<KasseSchlange, { anzahl: number; cent: number; unbekannt: number }>;
  stand: string;
  /** Firmen des Workspace für den Filter im Kopf (Umsetzung Plan 9, additiv). */
  firmen?: { id: string; name: string }[];
}

const akteHref = (dealId: string) => `/app/leads/${dealId}`;

/** Die vier Warteschlangen (Entscheidung 13). `heute` = Berliner Tag. */
export function kasseEintraege(deals: KasseDealRoh[], heute: string, stand: string): KasseAntwort {
  const schlangen: Record<KasseSchlange, KasseZeile[]> = { meldung: [], ohne_rechnung: [], offen: [], anzahlung: [] };
  const basis = (d: KasseDealRoh) => ({ dealId: d.dealId, name: d.name, nummer: d.nummer, firmaName: d.firmaName, href: akteHref(d.dealId) });
  const bis = tagPlusTage(heute, ANZAHLUNG_VORAUS_TAGE);
  for (const d of deals) {
    if (d.kategorie === "lost") continue;
    if (d.meldungen.length > 0) {
      const erste = d.meldungen.map((m) => m.gemeldetAm).sort()[0];
      schlangen.meldung.push({
        ...basis(d),
        betragCent: d.meldungen.reduce((s, m) => s + m.betragCent, 0),
        text: `gemeldet ${tagDe(berlinTag(erste))}`,
        seit: berlinTag(erste),
        gold: true,
        mahnreif: false,
      });
    }
    const gestellt = d.rechnung?.status === "gestellt";
    if (d.kategorie === "done_unpaid" && !gestellt) {
      schlangen.ohne_rechnung.push({
        ...basis(d),
        betragCent: d.offen.restCent,
        text: d.durchgefuehrtAm ? `durchgeführt ${tagDe(d.durchgefuehrtAm)}` : "durchgeführt",
        seit: d.durchgefuehrtAm,
        gold: true,
        mahnreif: false,
      });
    }
    if (gestellt && (d.offen.restCent == null || d.offen.restCent > 0)) {
      const f = d.rechnung!.faelligAm;
      const mahnreif = !!f && heute >= tagPlusTage(f, d.regel.erinnerungTage);
      const e = d.rechnung!.erinnerung;
      const teile = [
        f ? (heute > f ? `überfällig seit ${tagDe(tagPlusTage(f, 1))}` : `fällig ${tagDe(f)}`) : "ohne Fälligkeit",
        e ? `Erinnerung ${e.stufe} ${e.status === "gesendet" ? "gesendet" : e.status === "entwurf" ? "als Entwurf" : e.status} ${tagDe(berlinTag(e.am))}` : null,
        d.kanalFehlt ? "kein Kanal, bitte anrufen" : null,
        d.offen.restCent == null ? "Betrag offen" : null,
      ].filter(Boolean);
      schlangen.offen.push({ ...basis(d), betragCent: d.offen.restCent, text: teile.join(" · "), seit: f, gold: mahnreif, mahnreif });
    }
    if (
      d.kategorie === "booked" &&
      d.termin &&
      d.termin >= heute &&
      d.termin <= bis &&
      d.anzahlungCent != null &&
      d.anzahlungCent > 0 &&
      d.offen.bezahltCent < d.anzahlungCent
    ) {
      schlangen.anzahlung.push({
        ...basis(d),
        betragCent: d.anzahlungCent - d.offen.bezahltCent,
        text: `Termin ${tagDe(d.termin)}`,
        seit: d.termin,
        gold: true,
        mahnreif: false,
      });
    }
  }
  const summen = {} as KasseAntwort["summen"];
  for (const s of KASSE_SCHLANGEN) {
    schlangen[s].sort((a, b) => (a.seit ?? "9999").localeCompare(b.seit ?? "9999") || a.name.localeCompare(b.name));
    summen[s] = {
      anzahl: schlangen[s].length,
      cent: schlangen[s].reduce((x, z) => x + (z.betragCent ?? 0), 0),
      unbekannt: schlangen[s].filter((z) => z.betragCent == null).length,
    };
  }
  return { schlangen, summen, stand };
}

/** Zähler der Seitenleiste (Entscheidung 14): was auf euch wartet. */
export function kasseZaehler(a: KasseAntwort): number {
  return (
    a.schlangen.meldung.length +
    a.schlangen.ohne_rechnung.length +
    a.schlangen.offen.filter((z) => z.mahnreif).length +
    a.schlangen.anzahlung.length
  );
}

// ─── Tagesabschluss auf Heute ───────────────────────────────────────────────

/** Bis so viele Tage zurück erscheint ein vergangener Termin im Tagesabschluss. */
export const TAGESABSCHLUSS_TAGE = 30;

export interface BarBeiTeam {
  paymentId: string;
  mitarbeiter: string;
  cent: number;
}

export interface TagesabschlussRoh {
  dealId: string;
  name: string;
  nummer: string | null;
  kategorie: GeldKategorie | null;
  letzterTermintag: string | null;
  /** `move_time_entries.finished_at` (Klick „fertig“), ISO. */
  fertigAm: string | null;
  rechnung: { status: RechnungStatus } | null;
  restCent: number | null;
  barBeiTeam: BarBeiTeam[];
}

export type TagesabschlussSchrittArt = "bestaetigen" | "rechnung" | "bar";
export interface TagesabschlussSchritt {
  art: TagesabschlussSchrittArt;
  status: "erledigt" | "jetzt" | "spaeter";
  /** „Durchgeführt bestätigen“, „Rechnung erstellen“, „Bar bei Hans: 450,00 €“. */
  text: string;
  /** Nur `bar`: die Zahlungen, die „Bar erhalten“ abschließt. */
  paymentIds?: string[];
}

export interface TagesabschlussKarte {
  dealId: string;
  name: string;
  nummer: string | null;
  href: string;
  /** „Team meldet fertig 14:10“ oder „Termin war Do 05.11.“ */
  hinweis: string;
  schritte: TagesabschlussSchritt[];
}

function uhrzeit(iso: string): string {
  return new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
}

/** Karte oder null (Entscheidung 15). `heute` = Berliner Tag. */
export function tagesabschlussAus(d: TagesabschlussRoh, heute: string): TagesabschlussKarte | null {
  if (d.kategorie === "lost") return null;
  const frueheste = tagPlusTage(heute, -TAGESABSCHLUSS_TAGE);
  const imFenster = d.letzterTermintag != null && d.letzterTermintag >= frueheste;
  const vorbei = d.letzterTermintag != null && d.letzterTermintag < heute;
  const fertigHeute = d.fertigAm != null && berlinTag(d.fertigAm) <= heute;
  const offenBestaetigen = d.kategorie === "booked" && imFenster && (vorbei || fertigHeute);
  const gestellt = d.rechnung?.status === "gestellt";
  const offenRechnung = (d.kategorie === "done_unpaid" && imFenster && !gestellt) || (offenBestaetigen && !gestellt);
  const bar = d.barBeiTeam;
  if (!offenBestaetigen && !offenRechnung && bar.length === 0) return null;

  const bestaetigt = d.kategorie === "done_unpaid" || d.kategorie === "paid";
  const schritte: TagesabschlussSchritt[] = [];
  schritte.push({ art: "bestaetigen", status: bestaetigt ? "erledigt" : "jetzt", text: "Durchgeführt bestätigen" });
  schritte.push({
    art: "rechnung",
    status: gestellt ? "erledigt" : bestaetigt ? "jetzt" : "spaeter",
    text: gestellt ? "Rechnung gestellt" : "Rechnung erstellen",
  });
  const jeName = new Map<string, BarBeiTeam[]>();
  for (const b of bar) jeName.set(b.mitarbeiter, [...(jeName.get(b.mitarbeiter) ?? []), b]);
  for (const [name, liste] of jeName) {
    schritte.push({
      art: "bar",
      status: bestaetigt && gestellt ? "jetzt" : "spaeter",
      text: `Bar bei ${name}: ${euro(liste.reduce((s, b) => s + b.cent, 0))}`,
      paymentIds: liste.map((b) => b.paymentId),
    });
  }
  const hinweis =
    d.fertigAm && !bestaetigt
      ? `Team meldet fertig ${uhrzeit(d.fertigAm)}`
      : d.letzterTermintag
        ? `Termin war ${tagDe(d.letzterTermintag)}`
        : "Bargeld beim Team";
  return { dealId: d.dealId, name: d.name, nummer: d.nummer, href: akteHref(d.dealId), hinweis, schritte };
}

// ─── Akte ───────────────────────────────────────────────────────────────────

export interface ZahlungZeileAkte {
  id: string;
  date: string;
  cent: number;
  art: Zahlungsart | null;
  kaution: boolean;
  quelle: ZahlungQuelle | null;
  /** Name der Mitarbeiterin oder des Mitarbeiters bei `mitarbeiter`. */
  kassiertVon: string | null;
  belegnummer: string | null;
  notiz: string | null;
  /** Diese Zahlung ist durch eine Gegenbuchung storniert. */
  storniert: boolean;
  /** Diese Zeile ist selbst die Gegenbuchung. */
  istStorno: boolean;
  barOffen: boolean;
}

/** Ersetzt `AkteDaten.zahlung` (`lib/akte.ts:78`). */
export interface ZahlungAkte {
  restCent: number | null;
  gesamtCent: number | null;
  quelle: OffenQuelle;
  meldungen: Zahlungsmeldung[];
  rechnung: RechnungKurz | null;
  zahlungen: ZahlungZeileAkte[];
}

// ─── Zahlungserinnerung ─────────────────────────────────────────────────────

/** Kunde schrieb in so vielen Tagen: keine Erinnerung, erst antworten. */
export const ERINNERUNG_RUHE_TAGE = 3;

export type ErinnerungGrund =
  | "schalter_aus"
  | "kein_betrag"
  | "bezahlt"
  | "verloren"
  | "meldung_offen"
  | "beschwerde"
  | "kunde_schreibt"
  | "noch_nicht"
  | "entwurf_liegt"
  | "verworfen"
  | "fertig"
  | "kein_kanal";

export interface ErinnerungEingabe {
  regel: FirmenZahlungsregel;
  heute: string;
  rechnung: { status: RechnungStatus; bruttoCent: number | null; faelligAm: string | null };
  restCent: number | null;
  bisher: ErinnerungStand[];
  offeneMeldung: boolean;
  /** Letzte eingehende Kundennachricht, ISO. */
  letzteKundennachrichtAm: string | null;
  /** `sperreAusText` über Kundennachrichten seit dem Rechnungstag. */
  sperre: "legal" | "complaint" | string | null;
  bewertungGesperrt: boolean;
  verloren: boolean;
  kanal: "whatsapp" | "email" | null;
}

export type ErinnerungEntscheidung = { stufe: 1 | 2 } | { stufe: null; grund: ErinnerungGrund };

/** Entscheidung 19. */
export function erinnerungFaellig(e: ErinnerungEingabe): ErinnerungEntscheidung {
  const nein = (grund: ErinnerungGrund): ErinnerungEntscheidung => ({ stufe: null, grund });
  if (e.regel.erinnerungModus !== "entwurf") return nein("schalter_aus");
  if (e.rechnung.status !== "gestellt" || e.rechnung.bruttoCent == null || !e.rechnung.faelligAm) return nein("kein_betrag");
  if (e.restCent == null) return nein("kein_betrag");
  if (e.restCent <= 0) return nein("bezahlt");
  if (e.verloren) return nein("verloren");
  if (e.offeneMeldung) return nein("meldung_offen");
  if (e.sperre === "legal" || e.sperre === "complaint" || e.bewertungGesperrt) return nein("beschwerde");
  if (e.letzteKundennachrichtAm && berlinTag(e.letzteKundennachrichtAm) > tagPlusTage(e.heute, -ERINNERUNG_RUHE_TAGE)) {
    return nein("kunde_schreibt");
  }
  const s1 = e.bisher.find((b) => b.stufe === 1);
  const s2 = e.bisher.find((b) => b.stufe === 2);
  let stufe: 1 | 2;
  if (!s1) {
    if (e.heute < tagPlusTage(e.rechnung.faelligAm, e.regel.erinnerungTage)) return nein("noch_nicht");
    stufe = 1;
  } else if (s1.status === "entwurf") {
    return nein("entwurf_liegt");
  } else if (s1.status !== "gesendet") {
    return nein("verworfen");
  } else if (s2) {
    return nein(s2.status === "entwurf" ? "entwurf_liegt" : "fertig");
  } else {
    if (e.heute < tagPlusTage(berlinTag(s1.am), e.regel.erinnerung2Tage)) return nein("noch_nicht");
    stufe = 2;
  }
  if (!e.kanal) return nein("kein_kanal");
  return { stufe };
}

/** Kanal (G2): WhatsApp nur im 24-Stunden-Fenster und nie über das Ceylan-Konto, sonst E-Mail-Gespräch. */
export function erinnerungKanal(e: {
  whatsapp: { istCeylanKonto: boolean; letzteEingehendeAm: string | null } | null;
  emailGespraech: boolean;
  jetzt: Date;
}): "whatsapp" | "email" | null {
  const w = e.whatsapp;
  if (w && !w.istCeylanKonto && w.letzteEingehendeAm && e.jetzt.getTime() - Date.parse(w.letzteEingehendeAm) < 24 * 60 * 60 * 1000) {
    return "whatsapp";
  }
  return e.emailGespraech ? "email" : null;
}

export interface ErinnerungTextEingabe {
  anrede: "sie" | "du";
  stufe: 1 | 2;
  /** Vorname (du) bzw. voller Name (Sie); leer erlaubt. */
  name: string | null;
  nummer: string | null;
  rechnungstag: string | null;
  betragCent: number;
  faelligAm: string;
  portalLink: string;
  signatur: string;
}

function rechnungBezeichnung(e: Pick<ErinnerungTextEingabe, "nummer" | "rechnungstag">): string {
  if (e.nummer) return `Rechnung ${e.nummer}`;
  return e.rechnungstag ? `Rechnung vom ${tagDe(e.rechnungstag)}` : "Rechnung";
}

/** Betreff der E-Mail. Nie „Mahnung“ (G2). */
export function erinnerungBetreff(e: Pick<ErinnerungTextEingabe, "nummer" | "rechnungstag">): string {
  return `Zahlungserinnerung zur ${rechnungBezeichnung(e)}`;
}

/** Kundentext (Opus). Ohne Gebühr, ohne Zinsen, ohne interne Zahlen. */
export function erinnerungText(e: ErinnerungTextEingabe): string {
  const re = rechnungBezeichnung(e);
  const betrag = euro(e.betragCent);
  const name = (e.name ?? "").trim();
  if (e.anrede === "du") {
    const gruss = name ? `Hallo ${name},` : "Hallo,";
    const kern =
      e.stufe === 1
        ? `kurze Erinnerung zur ${re} über ${betrag}, fällig am ${tagDe(e.faelligAm)}. Falls die Zahlung schon unterwegs ist, ist alles gut und du kannst diese Nachricht ignorieren. Alle Angaben zur Überweisung findest du hier: ${e.portalLink}\n\nBei Fragen melde dich gern.`
        : `zur ${re} über ${betrag} ist bei uns noch keine Zahlung eingegangen. Kannst du bitte kurz nachsehen? Die Angaben zur Überweisung stehen hier: ${e.portalLink}\n\nWenn etwas nicht passt, sag einfach Bescheid, dann klären wir das.`;
    return `${gruss}\n\n${kern}\n\nViele Grüße\n${e.signatur}`;
  }
  const gruss = name ? `Guten Tag ${name},` : "Guten Tag,";
  const kern =
    e.stufe === 1
      ? `wir möchten Sie freundlich an die ${re} über ${betrag} erinnern, fällig am ${tagDe(e.faelligAm)}. Sollte die Zahlung bereits unterwegs sein, betrachten Sie diese Nachricht bitte als gegenstandslos. Die Angaben zur Überweisung finden Sie hier: ${e.portalLink}\n\nBei Fragen sind wir gern für Sie da.`
      : `zur ${re} über ${betrag} konnten wir bisher keinen Zahlungseingang feststellen. Bitte prüfen Sie das kurz. Die Angaben zur Überweisung finden Sie hier: ${e.portalLink}\n\nFalls etwas unklar ist, melden Sie sich gern bei uns.`;
  return `${gruss}\n\n${kern}\n\nFreundliche Grüße\n${e.signatur}`;
}

/** Kandidat für den Lauf (`services/zahlungserinnerung/auswahl.ts`). */
export interface ErinnerungKandidat {
  workspaceId: string;
  dealRecordId: string;
  invoiceId: string;
  operatingCompanyId: string | null;
  firma: "kottke" | "ceylan";
  eingabe: ErinnerungEingabe;
  text: Omit<ErinnerungTextEingabe, "stufe">;
  /** Gespräch für den Entwurf, passend zum Kanal. */
  conversationId: string | null;
}

export interface ErinnerungLauf {
  workspaces: number;
  geprueft: number;
  entwuerfe: number;
  gestoppt: number;
  ohneKanal: number;
  fehler: number;
  /** Zähler je Grund, für das Log. */
  gruende: Partial<Record<ErinnerungGrund, number>>;
}

export const ERINNERUNG_QUELLE = "zahlungserinnerung";
export function erinnerungSchluessel(invoiceId: string, stufe: 1 | 2): string {
  return `${ERINNERUNG_QUELLE}:${invoiceId}:${stufe}`;
}
