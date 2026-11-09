/**
 * Reine Hilfen der Seite Einstellungen (Plan 13, Task D): Formular-Zustand,
 * Zeitposten-Liste, Sperren und welche Änderung vorher fragt.
 */
import type { FirmenZahlungsregel } from "@/lib/geld";
import type { BewertungModus } from "@/lib/bewertungen-kunden";
import type { PortalSchalter, PortalSchalterName } from "@/lib/einstellungen-uebersicht";
import { parseReviewUrl } from "@/lib/reviews/review-url";
import type { ZeitpostenVorlage } from "@/lib/zeitposten";
import type { RueckfrageArt } from "./texte";

/** Höchstzahl Zeitposten (wie `pruefeZeitposten`). */
export const ZEITPOSTEN_MAX = 50;

/** Tiefer Vergleich für einfache JSON-Werte (Formular „geändert“). */
export function gleich(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    const bb = b as unknown[];
    return a.length === bb.length && a.every((x, i) => gleich(x, bb[i]));
  }
  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  const ka = Object.keys(ao).filter((k) => ao[k] !== undefined);
  const kb = Object.keys(bo).filter((k) => bo[k] !== undefined);
  return ka.length === kb.length && ka.every((k) => gleich(ao[k], bo[k]));
}

/** Knopf „Speichern“ nur bei Änderung und gültiger Eingabe, nicht während des Speicherns. */
export function speichernAktiv(gespeichert: unknown, entwurf: unknown, fehler: string | null, laeuft: boolean): boolean {
  return !laeuft && fehler === null && !gleich(gespeichert, entwurf);
}

// ─── Zahlung ────────────────────────────────────────────────────────────────

/** Eingabe als Text (Feld leer erlaubt), geprüft wie `pruefeZahlungsregel`. */
export function zahlFeld(text: string, von: number, bis: number): number | null {
  if (!/^\d{1,3}$/.test(text.trim())) return null;
  const n = Number(text.trim());
  return n >= von && n <= bis ? n : null;
}

export interface ZahlungEntwurf {
  basis: FirmenZahlungsregel["basis"];
  tage: string;
  erinnerungModus: FirmenZahlungsregel["erinnerungModus"];
  erinnerungTage: string;
  erinnerung2Tage: string;
}

export function zahlungEntwurfAus(r: FirmenZahlungsregel): ZahlungEntwurf {
  return {
    basis: r.basis,
    tage: String(r.tage),
    erinnerungModus: r.erinnerungModus,
    erinnerungTage: String(r.erinnerungTage),
    erinnerung2Tage: String(r.erinnerung2Tage),
  };
}

/** Gültige Regel oder der Name des ersten falschen Felds. */
export function zahlungAusEntwurf(e: ZahlungEntwurf): { ok: true; regel: FirmenZahlungsregel } | { ok: false; feld: keyof ZahlungEntwurf } {
  const tage = zahlFeld(e.tage, 0, 60);
  if (tage === null) return { ok: false, feld: "tage" };
  const erste = zahlFeld(e.erinnerungTage, 1, 60);
  if (erste === null) return { ok: false, feld: "erinnerungTage" };
  const zweite = zahlFeld(e.erinnerung2Tage, 1, 60);
  if (zweite === null) return { ok: false, feld: "erinnerung2Tage" };
  return { ok: true, regel: { basis: e.basis, tage, erinnerungModus: e.erinnerungModus, erinnerungTage: erste, erinnerung2Tage: zweite } };
}

// ─── Sperren ────────────────────────────────────────────────────────────────

/** Tagespreise gibt es nur mit „Angebot aus Kalkulation“ (Plan 5b). */
export function tagespreiseGesperrt(p: PortalSchalter): boolean {
  return !p.angebotAusKalkulation && !p.tagespreiseEnabled;
}

/** Ohne gültigen Google-Link: Entwurf und Senden gesperrt (Entscheidung 7 b). */
export function bewertungModusGesperrt(modus: BewertungModus, googleReviewUrl: string | null): boolean {
  return modus !== "aus" && !googleLinkGueltig(googleReviewUrl);
}

/** Dieselbe Prüfung wie Route und Bewertungsliste (`parseReviewUrl`). */
export function googleLinkGueltig(url: string | null | undefined): boolean {
  return parseReviewUrl(url).ok;
}

// ─── Rückfragen ─────────────────────────────────────────────────────────────

const PORTAL_FRAGE: Record<PortalSchalterName, RueckfrageArt> = {
  signatureEnabled: "unterschrift",
  angebotAusKalkulation: "angebotAusKalkulation",
  tagespreiseEnabled: "tagespreise",
};

/** Portal-Schalter: Einschalten fragt, Ausschalten nicht. */
export function portalRueckfrage(name: PortalSchalterName, wert: boolean): RueckfrageArt | null {
  return wert ? PORTAL_FRAGE[name] : null;
}

/** Zahlung: nur der Wechsel der Erinnerung von „aus“ auf „Entwurf“ fragt. */
export function zahlungRueckfrage(vorher: FirmenZahlungsregel, nachher: FirmenZahlungsregel): RueckfrageArt | null {
  return vorher.erinnerungModus === "aus" && nachher.erinnerungModus === "entwurf" ? "erinnerung" : null;
}

/** Google-Link: ein neuer oder geänderter Link fragt, Löschen nicht. */
export function googleRueckfrage(vorher: string | null, nachher: string): RueckfrageArt | null {
  const n = nachher.trim();
  return n !== "" && n !== (vorher ?? "") ? "googleLink" : null;
}

// ─── Zeitposten ─────────────────────────────────────────────────────────────

/** Eintrag an Position `i` um eins nach oben (-1) oder unten (+1); am Rand unverändert. */
export function zeitpostenVerschieben<T>(liste: readonly T[], i: number, richtung: -1 | 1): T[] {
  const j = i + richtung;
  if (i < 0 || i >= liste.length || j < 0 || j >= liste.length) return liste.slice();
  const aus = liste.slice();
  [aus[i], aus[j]] = [aus[j], aus[i]];
  return aus;
}

/** Zeitposten im Formular: Minuten als Text. */
export interface ZeitpostenEntwurf {
  id: string;
  bezeichnung: string;
  minuten: string;
  hinweis: string;
}

export function zeitpostenEntwurfAus(liste: readonly ZeitpostenVorlage[]): ZeitpostenEntwurf[] {
  return liste.map((z) => ({ id: z.id, bezeichnung: z.bezeichnung, minuten: String(z.minuten), hinweis: z.hinweis ?? "" }));
}

/** Liste für `PUT company-settings` oder der erste Fehler (wie `pruefeZeitposten`). */
export function zeitpostenAusEntwurf(
  liste: readonly ZeitpostenEntwurf[],
): { ok: true; liste: ZeitpostenVorlage[] } | { ok: false; fehler: string; index: number } {
  if (liste.length > ZEITPOSTEN_MAX) return { ok: false, fehler: "Höchstens 50 Zeitposten.", index: ZEITPOSTEN_MAX };
  const aus: ZeitpostenVorlage[] = [];
  for (const [i, z] of liste.entries()) {
    const bezeichnung = z.bezeichnung.trim();
    if (bezeichnung.length < 1 || bezeichnung.length > 80) return { ok: false, fehler: "Bezeichnung mit 1 bis 80 Zeichen.", index: i };
    const minuten = zahlFeld(z.minuten, 1, 600);
    if (minuten === null) return { ok: false, fehler: "Minuten als ganze Zahl von 1 bis 600.", index: i };
    const hinweis = z.hinweis.trim();
    aus.push(hinweis ? { id: z.id, bezeichnung, minuten, hinweis } : { id: z.id, bezeichnung, minuten });
  }
  return { ok: true, liste: aus };
}

// ─── Anzeige ────────────────────────────────────────────────────────────────

const EUR = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" });

/** Euro aus einer Zahl (Rechner liefert Euro). `null` = Strich. */
export function euroText(wert: number | null): string {
  return wert == null ? "–" : EUR.format(wert);
}

/** Berliner Datum TT.MM.JJJJ aus ISO oder `YYYY-MM-DD`. */
export function datumText(iso: string | null): string {
  if (!iso) return "–";
  const nurTag = /^\d{4}-\d{2}-\d{2}$/.test(iso);
  const d = new Date(nurTag ? `${iso}T12:00:00Z` : iso);
  if (Number.isNaN(d.getTime())) return "–";
  return d.toLocaleDateString("de-DE", { timeZone: "Europe/Berlin", day: "2-digit", month: "2-digit", year: "numeric" });
}

/** Erstes Wort des Firmennamens für das Segment (wie die Kasse). */
export function firmaKurz(name: string): string {
  return name.trim().split(/\s+/)[0] || name;
}

/** Ziel-ID aus `location.hash` (`#kalender`, `#rechner`, `#firma-<id>`); sonst null. */
export function ankerId(hash: string): string | null {
  let roh = hash.replace(/^#/, "");
  try {
    roh = decodeURIComponent(roh);
  } catch {
    return null;
  }
  return /^[A-Za-z][\w-]{0,99}$/.test(roh) ? roh : null;
}
