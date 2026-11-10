/**
 * Kunde und Adressen eines Deals (Akte, Vorprüfung vor KV/AB/RE), reine Logik
 * ohne Datenbank: Form der Daten, Prüfung der Eingabe, Umwandlung zwischen den
 * gespeicherten Werten und den Feldern im Formular.
 *
 * Gespeichert wird wie in der Akte: Adressen und Datum am Lead
 * (`move_from_address`, `move_to_address`, `move_date`), Name, Telefon und
 * E-Mail an der verknüpften Person. Die Auszugsadresse ist zugleich die
 * Kundenanschrift im KV (`kunde.adresse` der VPS-Vorlage).
 *
 * Plan-15-Regeln: Telefonnummern, Kundennummern, IBAN und Signaturen landen nie
 * als Adresse. Ein Feld, das im Aufruf fehlt, bleibt unverändert; leeren kann
 * man hier nichts (Schutz vor versehentlichem Löschen).
 */

export interface AdressTeile {
  /** Straße mit Hausnummer, darf fehlen (dann steht im KV nur PLZ und Ort). */
  strasse: string;
  plz: string;
  ort: string;
}

export interface DealKunde {
  personId: string | null;
  /** Anzeigename („Vorname Nachname“), leer ohne Person und ohne Lead-Namen. */
  name: string;
  /** true: der Name gehört zur verknüpften Person, sonst ist es der bereinigte Lead-Titel. */
  nameAusPerson: boolean;
  telefon: string | null;
  email: string | null;
  auszug: AdressTeile | null;
  einzug: AdressTeile | null;
  /** YYYY-MM-DD */
  datum: string | null;
}

export interface KundeEingabe {
  name?: string;
  telefon?: string;
  email?: string;
  auszug?: AdressTeile;
  einzug?: AdressTeile;
  datum?: string;
  /** Woher die Werte kommen (nur für das Ereignis). */
  quelle?: "akte" | "vorpruefung" | "chat";
}

export class KundeFehler extends Error {}

const BUCHSTABE = /\p{L}/u;
/** Nummern, die nie eine Adresse sind (Plan 15, Review I1). */
const KEINE_ADRESSE = /(\+\d|\btel\b|telefon|\bfax\b|mobil|handy|kunden\s*-?\s*n(?:umme)?r|kundennummer|rechnung\w*\s*\d|auftrags?\s*-?\s*n(?:umme)?r|\biban\b|\bbic\b|@|https?:|\d{6,})/iu;
/** Signatur- und Grußwörter: dann ist es keine Adresse, sondern der Rest einer Nachricht. */
const SIGNATUR = /(mit freundlichen|freundliche gr|viele gr|liebe gr|beste gr|gr(ü|ue)(ß|ss)e|\bmfg\b|\blg\b|gesendet von)/iu;

function text(x: unknown, max: number): string {
  return typeof x === "string" ? x.replace(/\s+/g, " ").trim().slice(0, max) : "";
}

/** true, wenn der Text als Straßenteil taugt (Buchstaben, keine Telefon- oder Kundennummer, keine Signatur). */
export function strasseGueltig(s: string): boolean {
  const t = s.trim();
  if (t === "") return true;
  return t.length <= 120 && BUCHSTABE.test(t) && !KEINE_ADRESSE.test(t) && !SIGNATUR.test(t);
}

/** Fünfstellige deutsche PLZ (01001 bis 99998). */
export function plzGueltig(plz: string): boolean {
  if (!/^\d{5}$/.test(plz)) return false;
  const n = Number(plz);
  return n >= 1001 && n <= 99998;
}

function ortGueltig(ort: string): boolean {
  return ort.length >= 2 && ort.length <= 80 && /^\p{Lu}/u.test(ort) && !/\d{3,}/.test(ort) && !KEINE_ADRESSE.test(ort) && !SIGNATUR.test(ort);
}

/** Prüft eine Adresse; wirft `KundeFehler` mit Text für die Oberfläche. */
export function pruefeAdresse(roh: unknown, label: string): AdressTeile {
  const o = (roh && typeof roh === "object" ? roh : {}) as Record<string, unknown>;
  const a = { strasse: text(o.strasse, 120), plz: text(o.plz, 5), ort: text(o.ort, 80) };
  if (!plzGueltig(a.plz)) throw new KundeFehler(`${label}: PLZ mit fünf Ziffern eintragen.`);
  if (!ortGueltig(a.ort)) throw new KundeFehler(`${label}: Ort eintragen.`);
  if (!strasseGueltig(a.strasse)) throw new KundeFehler(`${label}: Straße und Hausnummer prüfen, das sieht nach einer Telefon- oder Kundennummer aus.`);
  return a;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Prüft den Body von PUT …/kunde. Fehlende Felder bleiben weg (= unverändert). */
export function pruefeKundeEingabe(body: unknown): KundeEingabe {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const e: KundeEingabe = {};
  if (b.name !== undefined) {
    const name = text(b.name, 120);
    if (name.length < 2 || !BUCHSTABE.test(name) || name.includes("@") || /\d{3,}/.test(name)) {
      throw new KundeFehler("Name: Vor- und Nachname eintragen.");
    }
    e.name = name;
  }
  if (b.telefon !== undefined) {
    const t = text(b.telefon, 40);
    const ziffern = t.replace(/\D/g, "");
    if (!/^[+\d\s()/-]+$/.test(t) || ziffern.length < 6 || ziffern.length > 16) {
      throw new KundeFehler("Telefon: nur Ziffern, Leerzeichen, + und / eintragen.");
    }
    e.telefon = t;
  }
  if (b.email !== undefined) {
    const m = text(b.email, 160).toLowerCase();
    if (!EMAIL.test(m)) throw new KundeFehler("E-Mail: Adresse prüfen.");
    e.email = m;
  }
  if (b.auszug !== undefined) e.auszug = pruefeAdresse(b.auszug, "Auszug");
  if (b.einzug !== undefined) e.einzug = pruefeAdresse(b.einzug, "Einzug");
  if (b.datum !== undefined) {
    const d = text(b.datum, 10);
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d);
    const ok = m && !Number.isNaN(Date.UTC(+m[1], +m[2] - 1, +m[3])) && new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).getUTCDate() === +m[3];
    if (!ok) throw new KundeFehler("Datum: Tag wählen.");
    e.datum = d;
  }
  if (b.quelle === "akte" || b.quelle === "vorpruefung" || b.quelle === "chat") e.quelle = b.quelle;
  return e;
}

/** Gespeicherter Ortswert des Leads (jsonb oder Text) als Formularfelder; null ohne verwertbare Angabe. */
export function teileAusOrt(v: unknown): AdressTeile | null {
  if (!v) return null;
  if (typeof v === "string") return teileAusText(v);
  if (typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const s = (x: unknown) => (typeof x === "string" ? x.trim() : "");
  let strasse = s(o.line1);
  let plz = s(o.postcode);
  let ort = s(o.city);
  // „72218 Wildberg“ nur in line1 (Text ohne Komma gespeichert): PLZ und Ort herauslösen.
  if (!plz && !ort && strasse) {
    const t = teileAusText(strasse);
    if (t) ({ strasse, plz, ort } = t);
  }
  return strasse || plz || ort ? { strasse, plz, ort } : null;
}

/** „Hauptstr. 1, 72218 Wildberg“, „72218 Wildberg“ oder „Hauptstr. 1 72218 Wildberg“ als Felder. */
export function teileAusText(roh: string): AdressTeile | null {
  const t = roh.replace(/\s+/g, " ").trim();
  if (!t) return null;
  const m = /^(.*?)[,\s]*\b(\d{5})\b\s*,?\s*(.*)$/.exec(t);
  if (m) {
    return { strasse: m[1].replace(/[,\s]+$/, "").trim(), plz: m[2], ort: m[3].replace(/^[,\s]+/, "").trim() };
  }
  return { strasse: t, plz: "", ort: "" };
}

/** Formularfelder als gespeicherter Ortswert des Leads (Form wie die Adresssuche). */
export function ortAusTeilen(a: AdressTeile): { line1?: string; postcode: string; city: string; countryCode: string } {
  const strasse = a.strasse.trim();
  return { ...(strasse ? { line1: strasse } : {}), postcode: a.plz.trim(), city: a.ort.trim(), countryCode: "DE" };
}

/** Eine Zeile für Anzeige und KV: „Hauptstr. 1, 72218 Wildberg“. */
export function adressZeile(a: AdressTeile | null): string {
  if (!a) return "";
  return [a.strasse.trim(), [a.plz.trim(), a.ort.trim()].filter(Boolean).join(" ")].filter(Boolean).join(", ");
}

/** „Maria Anna Schmitt“ → Vorname „Maria Anna“, Nachname „Schmitt“. */
export function nameTeile(voll: string): { firstName: string; lastName: string; fullName: string } {
  const teile = voll.trim().split(/\s+/).filter(Boolean);
  const lastName = teile.length > 1 ? teile[teile.length - 1] : teile[0] ?? "";
  const firstName = teile.length > 1 ? teile.slice(0, -1).join(" ") : "";
  return { firstName, lastName, fullName: teile.join(" ") };
}

// ─── Vorschläge aus dem Chat (2c) ────────────────────────────────────────────

export interface KundeVorschlag {
  /** ki: frische KI-Auswertung des Chats; ki_gespeichert: letzte gespeicherte; erkennung: PLZ und Ort aus Nachrichten. */
  quelle: "ki" | "ki_gespeichert" | "erkennung" | null;
  name: string | null;
  email: string | null;
  telefon: string | null;
  auszug: AdressTeile | null;
  einzug: AdressTeile | null;
  /** Kurzer Hinweis für die Oberfläche, z. B. warum nichts gefunden wurde. */
  hinweis: string | null;
}

/** Adresse aus der KI oder Erkennung, nur wenn sie den Regeln genügt; sonst null. */
export function vorschlagAdresse(roh: string | null | undefined): AdressTeile | null {
  if (typeof roh !== "string" || roh.trim() === "") return null;
  // Signatur ab Grußformel abschneiden, bevor gelesen wird.
  const ohne = roh.split(/\r?\n/).filter((z, i, alle) => !alle.slice(0, i + 1).some((x) => SIGNATUR.test(x))).join(" ");
  const t = teileAusText(ohne);
  if (!t || !plzGueltig(t.plz) || !ortGueltig(t.ort.split(/[,;]/)[0].trim())) return null;
  const ort = t.ort.split(/[,;]/)[0].trim();
  // Eine Straße mit Nummer davor (Telefon, Kundennummer) verwerfen, PLZ und Ort behalten.
  const strasse = strasseGueltig(t.strasse) && /\d/.test(t.strasse) && /\p{L}{2,}/u.test(t.strasse) ? t.strasse : "";
  return { strasse, plz: t.plz, ort };
}

/** Name aus der KI, nur wenn es nach einem Namen aussieht. */
export function vorschlagName(roh: string | null | undefined): string | null {
  const t = text(roh, 120);
  if (t.length < 3 || !/\s/.test(t) || /[\d@]/.test(t) || !/^\p{Lu}/u.test(t)) return null;
  return t;
}

/** E-Mail aus der KI ohne Weiterleitungsadressen der Portale. */
export function vorschlagEmail(roh: string | null | undefined): string | null {
  const t = text(roh, 160).toLowerCase();
  if (!EMAIL.test(t) || /kleinanzeigen\.de$|immobilienscout|check24|relay/i.test(t)) return null;
  return t;
}

/** Telefonnummer aus der KI, nur plausible Ziffernfolgen. */
export function vorschlagTelefon(roh: string | null | undefined): string | null {
  const t = text(roh, 40);
  const ziffern = t.replace(/\D/g, "");
  return /^[+\d\s()/-]+$/.test(t) && ziffern.length >= 6 && ziffern.length <= 16 ? t : null;
}
