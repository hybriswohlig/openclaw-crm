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
import { einzugOffen } from "./adresse";

export interface AdressTeile {
  /** Straße mit Hausnummer, darf fehlen (dann steht im KV nur PLZ und Ort). */
  strasse: string;
  plz: string;
  ort: string;
  /** Adresszusatz aus der Adresssuche (`line2`, z. B. „3. OG“): bleibt beim Ändern erhalten. */
  zusatz?: string;
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
  /** Einzug noch offen (Inhaber 10.11.): im KV steht bei NACH „wird noch abgestimmt“. */
  einzugOffen: boolean;
  /** YYYY-MM-DD */
  datum: string | null;
}

export interface KundeEingabe {
  name?: string;
  telefon?: string;
  email?: string;
  auszug?: AdressTeile;
  einzug?: AdressTeile;
  /** true: Einzug noch offen (ersetzt den Einzug); false: wieder eine Adresse (dann `einzug` Pflicht). */
  einzugOffen?: boolean;
  datum?: string;
  /** Woher die Werte kommen (nur für das Ereignis). */
  quelle?: "akte" | "vorpruefung" | "chat";
  /**
   * Antwort auf „Es gibt schon … mit dieser Nummer“ (nur ohne verknüpfte Person):
   * „neu“ legt eine neue Person an, `verknuepfen` nimmt die genannte bestehende.
   */
  personWahl?: "neu" | { verknuepfen: string };
}

export class KundeFehler extends Error {}

export { einzugOffen } from "./adresse";

const BUCHSTABE = /\p{L}/u;
/** Signatur- und Grußwörter: dann ist es keine Adresse, sondern der Rest einer Nachricht. */
const SIGNATUR = /(mit freundlichen|freundliche gr|viele gr|liebe gr|beste gr|gr(ü|ue)(ß|ss)e|\bmfg\b|\blg\b|gesendet von)/iu;
/** Wörter vor einer Nummer, die nie Teil einer Adresse ist (Review I3). Ohne „Nr.“ allein: „Hauptstr. Nr. 5“ gibt es. */
const NUMMERWORT =
  "kunden-?(?:nummer|nr|konto)|kd\\.?-?\\s?nr|auftrags?-?(?:nummer|nr)?|rechnungs?-?(?:nummer|nr)?|vorgangs?-?(?:nummer|nr)?|" +
  "bestell-?(?:nummer|nr)|referenz(?:nummer)?|ticket|aktenzeichen|az|tel|telefon|fax|mobil|handy|whatsapp|iban|bic";
/** Nummernwort, gefolgt von einer Zahl („Auftrag 4711“, „Kd.-Nr. 12“, „Tel: 0711 …“). */
const NUMMER_MIT_ZAHL = new RegExp(`(?:^|[^\\p{L}])(?:${NUMMERWORT})\\.?\\s*[:#.\\-]?\\s*\\d`, "iu");
/** Unmittelbar vor einer PLZ: dann ist es keine PLZ („Kundennummer 72218“, „Nr. 72218“). */
const NUMMER_DAVOR = new RegExp(`(?:^|[^\\p{L}])(?:${NUMMERWORT}|nr|nummer)\\.?\\s*[:#.\\-]?\\s*$`, "iu");
/** Telefonnummer: sechs oder mehr Ziffern, auch mit Leerzeichen, Schrägstrich, Punkt oder Bindestrich dazwischen, oder +49. */
const TELEFON = /(\+\s?\d|\d(?:[\s/.\-]*\d){5,})/u;
/** Eine Zahlengruppe vor dem Straßennamen („0711 123 Hauptstr. 5“, „4711 Hauptstr.“). */
const ZAHL_VORN = /^\s*[+\d][\d\s/.\-]*\s+\p{L}/u;

function text(x: unknown, max: number): string {
  return typeof x === "string" ? x.replace(/\s+/g, " ").trim().slice(0, max) : "";
}

/** Was mit dem Straßenteil nicht stimmt, als Satzteil; null, wenn er taugt (leer taugt auch). */
export function strasseProblem(s: string): string | null {
  const t = s.trim();
  if (t === "") return null;
  if (t.length > 120) return "ist zu lang";
  if (!BUCHSTABE.test(t)) return "braucht einen Straßennamen";
  if (/@|https?:|www\./i.test(t) || SIGNATUR.test(t)) return "enthält keine Adresse";
  if (TELEFON.test(t) || ZAHL_VORN.test(t)) return "enthält eine Telefonnummer oder eine andere lange Nummer";
  if (NUMMER_MIT_ZAHL.test(t)) return "enthält eine Auftrags-, Kunden-, Rechnungs- oder Vorgangsnummer";
  return null;
}

/** true, wenn der Text als Straßenteil taugt (Buchstaben, keine Telefon-, Auftrags- oder Kundennummer, keine Signatur). */
export function strasseGueltig(s: string): boolean {
  return strasseProblem(s) === null;
}

/** Fünfstellige deutsche PLZ (01001 bis 99998). */
export function plzGueltig(plz: string): boolean {
  if (!/^\d{5}$/.test(plz)) return false;
  const n = Number(plz);
  return n >= 1001 && n <= 99998;
}

/** Ortsname: Buchstaben, keine Nummern, keine Signatur. `streng` (Text aus dem Chat): großer Anfangsbuchstabe. */
function ortGueltig(ort: string, streng = true): boolean {
  return (
    ort.length >= 2 &&
    ort.length <= 80 &&
    (!streng || /^\p{Lu}/u.test(ort)) &&
    /^\p{L}/u.test(ort) &&
    !/\d/.test(ort) &&
    !NUMMER_MIT_ZAHL.test(ort) &&
    !/@/.test(ort) &&
    !SIGNATUR.test(ort)
  );
}

/** „stuttgart“ → „Stuttgart“ (nur der erste Buchstabe; „Frankfurt am Main“ bleibt). */
export function ortNormal(ort: string): string {
  const t = ort.trim();
  return t ? t.charAt(0).toLocaleUpperCase("de-DE") + t.slice(1) : t;
}

/** Prüft eine Adresse; wirft `KundeFehler` mit Text für die Oberfläche. */
export function pruefeAdresse(roh: unknown, label: string, opts: { plzPflicht?: boolean } = {}): AdressTeile {
  const o = (roh && typeof roh === "object" ? roh : {}) as Record<string, unknown>;
  const a = { strasse: text(o.strasse, 120), plz: text(o.plz, 5), ort: ortNormal(text(o.ort, 80)) };
  const zusatz = text(o.zusatz, 80);
  // Einzug (Inhaber 10.11.): PLZ darf fehlen („nur Ort“), eine eingetragene muss stimmen.
  if ((opts.plzPflicht !== false || a.plz) && !plzGueltig(a.plz)) throw new KundeFehler(`${label}: PLZ mit fünf Ziffern eintragen, z. B. 70372.`);
  if (!a.ort) throw new KundeFehler(`${label}: Ort eintragen, z. B. Stuttgart.`);
  if (!ortGueltig(a.ort, false)) throw new KundeFehler(`${label}: Im Ort nur den Ortsnamen eintragen, ohne Ziffern, z. B. Stuttgart.`);
  const problem = strasseProblem(a.strasse);
  if (problem) throw new KundeFehler(`${label}: Die Straße ${problem}. Bitte nur Straße und Hausnummer eintragen.`);
  return zusatz ? { ...a, zusatz } : a;
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
  if (b.einzug !== undefined) e.einzug = pruefeAdresse(b.einzug, "Einzug", { plzPflicht: false });
  if (b.einzugOffen === true || b.einzugOffen === false) e.einzugOffen = b.einzugOffen;
  if (e.einzugOffen === true && e.einzug) throw new KundeFehler("Einzug: entweder eine Adresse oder „Einzug noch offen“.");
  if (b.datum !== undefined) {
    const d = text(b.datum, 10);
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d);
    const ok = m && !Number.isNaN(Date.UTC(+m[1], +m[2] - 1, +m[3])) && new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).getUTCDate() === +m[3];
    if (!ok) throw new KundeFehler("Datum: Tag wählen.");
    e.datum = d;
  }
  if (b.quelle === "akte" || b.quelle === "vorpruefung" || b.quelle === "chat") e.quelle = b.quelle;
  if (b.personWahl === "neu") e.personWahl = "neu";
  else if (b.personWahl && typeof b.personWahl === "object") {
    const id = (b.personWahl as Record<string, unknown>).verknuepfen;
    if (typeof id === "string" && id.trim()) e.personWahl = { verknuepfen: id.trim() };
  }
  return e;
}

/** Gespeicherter Ortswert des Leads (jsonb oder Text) als Formularfelder; null ohne verwertbare Angabe. */
export function teileAusOrt(v: unknown): AdressTeile | null {
  if (!v || einzugOffen(v)) return null;
  if (typeof v === "string") return teileAusText(v);
  if (typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const s = (x: unknown) => (typeof x === "string" ? x.trim() : "");
  let strasse = s(o.line1);
  let plz = s(o.postcode);
  let ort = s(o.city);
  const zusatz = s(o.line2);
  // „72218 Wildberg“ nur in line1 (Text ohne Komma gespeichert): PLZ und Ort herauslösen.
  if (!plz && !ort && strasse) {
    const t = teileAusText(strasse);
    if (t) ({ strasse, plz, ort } = t);
  }
  if (!strasse && !plz && !ort) return null;
  return zusatz ? { strasse, plz, ort, zusatz } : { strasse, plz, ort };
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
export function ortAusTeilen(a: AdressTeile): { line1?: string; line2?: string; postcode: string; city: string; countryCode: string } {
  const strasse = a.strasse.trim();
  const zusatz = a.zusatz?.trim() ?? "";
  return { ...(strasse ? { line1: strasse } : {}), ...(zusatz ? { line2: zusatz } : {}), postcode: a.plz.trim(), city: a.ort.trim(), countryCode: "DE" };
}

/** Eine Zeile für Anzeige und KV: „Hauptstr. 1, 72218 Wildberg“. */
export function adressZeile(a: AdressTeile | null): string {
  if (!a) return "";
  return [a.strasse.trim(), a.zusatz?.trim(), [a.plz.trim(), a.ort.trim()].filter(Boolean).join(" ")].filter(Boolean).join(", ");
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

/**
 * Adresse aus der KI oder Erkennung, nur wenn sie den Regeln genügt; sonst null.
 * Es zählt die erste fünfstellige Zahl, vor der kein Nummernwort und keine
 * Zahlengruppe steht („Kundennummer 72218“, „0711 12345“ sind keine PLZ), mit
 * einem Ortsnamen dahinter. Die Straße ist das Stück davor (nach dem letzten
 * Komma) und nur, wenn sie die Straßenregeln erfüllt; sonst bleiben PLZ und Ort.
 */
export function vorschlagAdresse(roh: string | null | undefined): AdressTeile | null {
  if (typeof roh !== "string" || roh.trim() === "") return null;
  // Signatur ab Grußformel abschneiden, bevor gelesen wird.
  const zeilen = roh.split(/\r?\n/);
  const ende = zeilen.findIndex((z) => SIGNATUR.test(z));
  const t = (ende === -1 ? zeilen : zeilen.slice(0, ende)).join(", ").replace(/\s+/g, " ").trim();
  for (const m of t.matchAll(/(?<![\d+])(\d{5})(?!\d)/g)) {
    const plz = m[1];
    const davor = t.slice(0, m.index);
    if (!plzGueltig(plz) || NUMMER_DAVOR.test(davor)) continue;
    // Zahlengruppe direkt davor (mehr als drei Ziffern samt Trennern): Teil einer Telefonnummer.
    const gruppe = /[\d\s/.\-]*$/.exec(davor)?.[0] ?? "";
    if (gruppe.replace(/\D/g, "").length > 3 || /\+\s*[\d\s]*$/.test(davor)) continue;
    const ort = t
      .slice((m.index ?? 0) + plz.length)
      .replace(/^[\s,]+/, "")
      .split(/[,;()]/)[0]
      .trim();
    if (!ortGueltig(ort)) continue;
    const stueck = (davor.replace(/[,;\s]+$/, "").split(/[,;]/).pop() ?? "").trim();
    const strasse = strasseGueltig(stueck) && /\d/.test(stueck) && /\p{L}{2,}/u.test(stueck) ? stueck : "";
    return { strasse, plz, ort };
  }
  return null;
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
