/**
 * Elektronische Widerrufsfunktion (§ 356a BGB, seit 19.06.2026): wann der
 * Button „Vertrag widerrufen“ im Portal steht und was der Kunde dabei angibt.
 * Portal (Client) und Widerrufs-Route (Server) nutzen dieselben Funktionen.
 */
import { berlinDateString } from "./stage-derivation";
import type { WiderrufModus } from "./annahme-recht";

const TAG_MS = 24 * 60 * 60 * 1000;

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function plusTage(ymdStr: string, tage: number): string {
  return ymd(new Date(Date.parse(`${ymdStr}T00:00:00Z`) + tage * TAG_MS));
}

/** Ostersonntag (Gauß, gregorianisch) als YYYY-MM-DD. */
function ostersonntag(jahr: number): string {
  const a = jahr % 19;
  const b = Math.floor(jahr / 100);
  const c = jahr % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const monat = Math.floor((h + l - 7 * m + 114) / 31);
  const tag = ((h + l - 7 * m + 114) % 31) + 1;
  return `${jahr}-${String(monat).padStart(2, "0")}-${String(tag).padStart(2, "0")}`;
}

/** Buß- und Bettag: Mittwoch vor dem 23. November. */
function bussUndBettag(jahr: number): string {
  const wochentag22 = new Date(Date.UTC(jahr, 10, 22)).getUTCDay();
  return `${jahr}-11-${String(22 - ((wochentag22 - 3 + 7) % 7)).padStart(2, "0")}`;
}

/**
 * Gesetzliche Feiertage des Bundes und aller Länder. § 193 BGB stellt auf
 * den Ort der Erklärung ab; mit der Vereinigung ist die Frist nie zu kurz.
 */
function feiertage(jahr: number): Set<string> {
  const ostern = ostersonntag(jahr);
  return new Set([
    `${jahr}-03-08`,
    `${jahr}-08-15`,
    `${jahr}-09-20`,
    `${jahr}-10-31`,
    bussUndBettag(jahr),
    `${jahr}-01-01`,
    `${jahr}-01-06`,
    plusTage(ostern, -2),
    plusTage(ostern, 1),
    `${jahr}-05-01`,
    plusTage(ostern, 39),
    plusTage(ostern, 50),
    plusTage(ostern, 60),
    `${jahr}-10-03`,
    `${jahr}-11-01`,
    `${jahr}-12-25`,
    `${jahr}-12-26`,
  ]);
}

function istWerktag(ymdStr: string): boolean {
  const wochentag = new Date(`${ymdStr}T00:00:00Z`).getUTCDay();
  if (wochentag === 0 || wochentag === 6) return false;
  return !feiertage(Number(ymdStr.slice(0, 4))).has(ymdStr);
}

/**
 * Letzter Tag der Widerrufsfrist bei Dienstleistungen: 14 Tage ab dem Tag
 * des Vertragsschlusses (Berliner Kalendertag, §§ 187 Abs. 1, 188 Abs. 1
 * BGB). Fällt er auf Samstag, Sonntag oder Feiertag, gilt der nächste
 * Werktag (§ 193 BGB).
 */
export function widerrufsfristEnde(vertragsschluss: Date): string {
  let ende = plusTage(berlinDateString(vertragsschluss), 14);
  while (!istWerktag(ende)) ende = plusTage(ende, 1);
  return ende;
}

/** Ein Klick kurz vor Mitternacht kommt manchmal erst danach an (§ 356a Abs. 5 BGB). */
const KULANZ_MS = 30 * 60 * 1000;

/**
 * Der Button steht während der ganzen Frist bereit (§ 356a Abs. 1 S. 3 BGB),
 * nur bei Verträgen mit Widerrufsrecht. Altbestand (Modus null) und Umzug
 * mit festem Termin haben keinen. Hat der Kunde den Beginn vor Fristende
 * verlangt und ist die Leistung vollständig erbracht, ist das Recht
 * erloschen (§ 356 Abs. 4 BGB).
 */
export function widerrufsfunktionAktiv(input: {
  widerrufModus: WiderrufModus | null;
  signedAt: Date;
  now: Date;
  vorzeitigerBeginnVerlangt?: boolean;
  leistungErbracht?: boolean;
}): boolean {
  if (input.widerrufModus !== "belehrung") return false;
  if (input.vorzeitigerBeginnVerlangt && input.leistungErbracht) return false;
  return berlinDateString(new Date(input.now.getTime() - KULANZ_MS)) <= widerrufsfristEnde(input.signedAt);
}

/** Bekannte E-Mail, bekannter WhatsApp-Chat oder eine neu eingegebene Adresse. */
export type WiderrufKanal = "email" | "whatsapp" | "email_neu";

export interface WiderrufPayload {
  name: string;
  kanal: WiderrufKanal;
  /** Nur bei email_neu. */
  email: string | null;
  /** Zeitpunkt der Annahme, die der Kunde im Dialog gesehen hat (ISO). */
  annahmeAm: string | null;
}

const KANAELE = new Set<WiderrufKanal>(["email", "whatsapp", "email_neu"]);

/** Angaben nach § 356a Abs. 2 BGB: Name, Kanal für die Eingangsbestätigung. */
export function parseWiderrufPayload(raw: unknown): WiderrufPayload | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const b = raw as Record<string, unknown>;
  // Ein Name ist eine Zeile: Umbrüche und Steuerzeichen würden sonst in die Mail rutschen.
  const name =
    typeof b.name === "string"
      ? b.name.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 200)
      : "";
  if (!name) return null;
  const kanal = typeof b.kanal === "string" ? (b.kanal as WiderrufKanal) : null;
  if (!kanal || !KANAELE.has(kanal)) return null;
  const annahmeAm = typeof b.annahmeAm === "string" && b.annahmeAm.length <= 40 ? b.annahmeAm : null;
  if (kanal !== "email_neu") return { name, kanal, email: null, annahmeAm };
  const email = typeof b.email === "string" ? b.email.trim().slice(0, 254) : "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return { name, kanal, email, annahmeAm };
}
