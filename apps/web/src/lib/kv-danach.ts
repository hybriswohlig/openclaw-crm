/**
 * Nach dem KV direkt zum Kunden (Inhaber, 11.11.): reine Logik für
 * „Statuslink kopieren“, „Im Chat senden“ und die Pakete-Zeile im KV-Fenster.
 * Kein Netz, keine Datenbank, kein React. Kundentexte: Kottke duzt, alle
 * anderen (Ceylan) siezen, wie im Portal (`kundenText`). Keine Gedankenstriche.
 */
import { kundenText } from "@openclaw-crm/customer-portal-core";
import { euroText } from "@/lib/anzeige";

// ─── Statuslink ──────────────────────────────────────────────────────────────

/** Antwort von `apiAufruf` in der Form, die hier gelesen wird. */
type Antwort<T> = { ok: true; data: T } | { ok: false; status: number; message: string };

/** `GET /api/v1/customer-link/{deal}` (Ausschnitt). */
export interface LinkGet {
  url?: string | null;
  dealNumber?: string | null;
  revokedAt?: string | null;
}

/** `POST /api/v1/customer-link/{deal}` (Ausschnitt). */
export interface LinkPost {
  url?: string | null;
  dealNumber?: string | null;
  skipped?: boolean;
}

export type StatusLink =
  | { art: "ok"; url: string; dealNumber: string | null; neu: boolean }
  /** Link gesperrt: nie still entsperren, das entscheidet ein Mensch (Widerrufsfrist, falsche Hände). */
  | { art: "gesperrt" }
  | { art: "portal_aus" }
  | { art: "fehler"; text: string };

/**
 * Erst lesen: gibt es den Link, nimm ihn (gesperrt bleibt gesperrt). Nur bei
 * 404 „anlegen“ über den bestehenden Weg (`POST`, idempotent).
 */
export function statusLinkAusGet(a: Antwort<LinkGet | null>): StatusLink | "anlegen" {
  if (!a.ok) return a.status === 404 ? "anlegen" : { art: "fehler", text: a.message };
  if (!a.data) return "anlegen";
  if (a.data.revokedAt) return { art: "gesperrt" };
  if (typeof a.data.url === "string" && a.data.url !== "") {
    return { art: "ok", url: a.data.url, dealNumber: a.data.dealNumber ?? null, neu: false };
  }
  return { art: "fehler", text: "Der Server hat keinen Link geliefert." };
}

export function statusLinkAusPost(a: Antwort<LinkPost | null>): StatusLink {
  if (!a.ok) return { art: "fehler", text: a.message };
  if (a.data?.skipped) return { art: "portal_aus" };
  if (typeof a.data?.url === "string" && a.data.url !== "") {
    return { art: "ok", url: a.data.url, dealNumber: a.data.dealNumber ?? null, neu: true };
  }
  return { art: "fehler", text: "Der Server hat keinen Link geliefert." };
}

/** Wo ein gesperrter Link entsperrt oder erneuert wird: Kunden-Link-Kasten der alten Akte. */
export function linkVerwaltenUrl(dealId: string): string {
  return `/objects/deals/${encodeURIComponent(dealId)}?alt=1`;
}

export const PORTAL_EINSTELLUNGEN_URL = "/app/einstellungen#einst-firmen";

/** Meldung, wenn es keinen nutzbaren Link gibt (intern, du). */
export function statusLinkMeldung(l: Exclude<StatusLink, { art: "ok" }>): { titel: string; text: string } {
  switch (l.art) {
    case "gesperrt":
      return {
        titel: "Kunden-Link ist gesperrt.",
        text: "Entsperren oder einen neuen Link erstellen geht im Kasten „Kunden-Link“ der alten Akte.",
      };
    case "portal_aus":
      return { titel: "Kundenportal ist für diese Firma aus.", text: "Einschalten unter Einstellungen, Kundenportal." };
    case "fehler":
      return { titel: "Statuslink konnte nicht geholt werden.", text: l.text };
  }
}

// ─── Kurztext „Angebot ist fertig“ ───────────────────────────────────────────

export type KvPreis =
  | { art: "fest"; cent: number }
  /** Paketoptionen des Deals im Portal: „ab“ dem günstigsten. */
  | { art: "pakete"; abCent: number; anzahl: number }
  | { art: "stunden" }
  /** Kein Preis bekannt: der Satz entfällt, der Link zeigt ihn. */
  | { art: "offen" };

/**
 * Preis aus `GET /deals/{id}/quotation` (Ausschnitt) und den Paketoptionen des
 * Deals (`GET /deals/{id}/package-options`, dieselben Karten wie im Portal).
 * Ab zwei Optionen gilt der Paketsatz, sonst Festpreis oder Stunden.
 */
export function kvPreisAus(
  q: { fixedPrice?: string | number | null; isVariable?: boolean | null } | null | undefined,
  optionen: readonly { priceCents?: number | null }[] = []
): KvPreis {
  const preise = optionen.map((o) => o.priceCents).filter((c): c is number => typeof c === "number" && c > 0);
  if (preise.length >= 2) return { art: "pakete", abCent: Math.min(...preise), anzahl: preise.length };
  if (!q) return { art: "offen" };
  if (q.isVariable) return { art: "stunden" };
  const roh = q.fixedPrice;
  const eur = typeof roh === "number" ? roh : typeof roh === "string" && roh.trim() !== "" ? Number(roh) : NaN;
  if (!Number.isFinite(eur) || eur <= 0) return { art: "offen" };
  return { art: "fest", cent: Math.round(eur * 100) };
}

/**
 * Nachricht nach dem KV, nur ins Eingabefeld (nie gesendet): Angebot ist
 * fertig, Preis, Link, Bitte um Rückmeldung. Aufbau wie `renderSnippet`
 * („Hallo {Vorname},“, „(Auftrag …)“, „Viele Grüße“ und Firma).
 */
export function kvFertigNachricht(e: {
  /** Anzeigename der Firma (entscheidet du/Sie und steht im Gruß). */
  firma: string | null;
  vorname: string | null;
  preis: KvPreis;
  url: string;
  dealNumber?: string | null;
}): string {
  const t = (sie: string, du: string) => kundenText(e.firma, sie, du);
  const anrede = e.vorname ? `Hallo ${e.vorname},` : "Hallo,";
  const ref = e.dealNumber ? ` (Auftrag ${e.dealNumber})` : "";
  const saetze = [t(`Ihr Angebot${ref} ist fertig.`, `dein Angebot${ref} ist fertig.`)];
  if (e.preis.art === "fest") {
    saetze.push(`Der Festpreis liegt bei ${euroText(e.preis.cent)}.`);
  } else if (e.preis.art === "pakete") {
    const ab = euroText(e.preis.abCent);
    saetze.push(
      t(
        `Sie können zwischen ${e.preis.anzahl} Paketen wählen, ab ${ab} zum Festpreis.`,
        `Du kannst zwischen ${e.preis.anzahl} Paketen wählen, ab ${ab} zum Festpreis.`
      )
    );
  } else if (e.preis.art === "stunden") {
    saetze.push("Abgerechnet wird nach Aufwand, die Stundensätze stehen im Angebot.");
  }
  const link = t(
    "Alle Details sehen Sie hier, dort können Sie das Angebot auch direkt annehmen:",
    "Alle Details siehst du hier, dort kannst du das Angebot auch direkt annehmen:"
  );
  const bitte = t(
    "Geben Sie mir gern kurz Bescheid, ob alles passt oder ob Sie noch Fragen haben.",
    "Gib mir gern kurz Bescheid, ob alles passt oder ob du noch Fragen hast."
  );
  const gruss = e.firma?.trim() ? `Viele Grüße\n${e.firma.trim()}` : "Viele Grüße";
  return `${anrede}\n\n${saetze.join(" ")}\n\n${link}\n${e.url}\n\n${bitte}\n\n${gruss}`;
}

/** Abfrage-Schlüssel der Inbox: Kurztext zum KV vorbereiten. */
export const KV_NACHRICHT_PARAM = "kv";

/** „Im Chat senden“: die neue Inbox im Eintrag des Deals, Kurztext wird dort vorbereitet. */
export function kvChatUrl(dealId: string): string {
  const p = new URLSearchParams({ e: `deal:${dealId}`, [KV_NACHRICHT_PARAM]: "1" });
  return `/app/inbox?${p.toString()}`;
}

// ─── Pakete-Zeile im KV-Fenster ──────────────────────────────────────────────

/** Gleiche Form wie `PaketSchalterAnsicht` (lib/kalkulations-ansicht). */
export interface PaketSchalterStand {
  firma: boolean;
  deal: "an" | "aus" | null;
  wirksam: boolean;
  pakete: { aktiv: number; basis: boolean };
}

export interface PaketeZeileEingabe {
  schalter: PaketSchalterStand | null;
  /** Firmen-Schalter „Tagespreise“. */
  tagespreise: boolean;
  preisModus: "fest" | "stunden";
  /** Pakete der gezeigten Version (leer = keine Paketpreise). */
  pakete: readonly { name: string }[];
  /** Angebotene Tage der Version. */
  tage: number;
  gesperrt: boolean;
}

export interface PaketeZeile {
  angeboten: boolean;
  /** „Pakete: werden angeboten (Basis, Komfort, Premium)“ bzw. „Pakete: nicht angeboten“ */
  text: string;
  grund: string | null;
  /** Schalter für diesen Deal; `wert` geht beim Umschalten an `PUT …/calculation/pakete`. */
  schalter: { an: boolean; wert: "standard" | "an" | "aus" } | null;
  /** Darf die Firma es nicht: der Weg in die Einstellungen. */
  einstellungen: { href: string; text: string } | null;
  /** Gesperrte Version: Änderungen brauchen eine neue Version. */
  gesperrtHinweis: string | null;
  /** „Tagespreise: …“ */
  tagespreise: string;
}

export const PAKETE_ANLEGEN_URL = "/settings/customer-portal";

function tageText(n: number): string {
  return n === 1 ? "1 Tag" : `${n} Tage`;
}

export function tagespreiseZeile(e: Pick<PaketeZeileEingabe, "tagespreise" | "preisModus" | "tage">): string {
  if (!e.tagespreise) return "Tagespreise: für diese Firma aus.";
  if (e.preisModus === "stunden") return "Tagespreise: beim Stunden-KV nicht.";
  if (e.tage > 0) return `Tagespreise: ${tageText(e.tage)} im Angebot.`;
  return "Tagespreise: keine Tage gewählt, das geht im Termin-Dialog.";
}

/**
 * Ob und warum Pakete im KV stehen. „Angeboten“ heißt: die Version trägt
 * Paketpreise. Der Schalter je Deal (Plan 15, `pakete_anbieten`) erscheint am
 * Entwurf; Einschalten nur, wenn die Firma „Angebot aus Kalkulation“ an hat
 * und ein Basis-Paket führt, sonst der Link in die Einstellungen. Ausschalten
 * geht immer. An einer gesperrten Version kein Schalter, nur der Hinweis.
 */
export function paketeZeile(e: PaketeZeileEingabe): PaketeZeile {
  const s = e.schalter;
  const stunden = e.preisModus === "stunden";
  const angeboten = !stunden && e.pakete.length > 0;
  const text = angeboten
    ? `Pakete: werden angeboten (${e.pakete.map((p) => p.name).join(", ")})`
    : "Pakete: nicht angeboten";

  let grund: string | null = null;
  if (!angeboten) {
    if (stunden) grund = "Stunden-KV: Pakete gibt es nur beim Festpreis.";
    else if (!s) grund = null;
    else if (s.deal === "aus") grund = "Für diesen Deal ausgeschaltet.";
    else if (!s.wirksam) grund = "Firmen-Schalter „Angebot aus Kalkulation“ ist aus.";
    else if (!s.pakete.basis) grund = "Die Firma hat kein Basis-Paket.";
    else grund = e.gesperrt ? "Diese Version wurde ohne Pakete gesperrt." : "Noch keine Paketpreise, bitte neu rechnen.";
  }

  let schalter: PaketeZeile["schalter"] = null;
  let einstellungen: PaketeZeile["einstellungen"] = null;
  if (!e.gesperrt && s && !stunden) {
    if (s.wirksam) {
      // Aus: bei Firma „an“ ausdrücklich aus, sonst zurück auf den Firmenstandard (aus).
      schalter = { an: true, wert: s.firma ? "aus" : "standard" };
    } else if (s.firma && s.pakete.basis) {
      schalter = { an: false, wert: s.deal === "aus" ? "standard" : "an" };
    } else if (!s.firma) {
      einstellungen = { href: PORTAL_EINSTELLUNGEN_URL, text: "Einstellungen, Kundenportal" };
    } else {
      einstellungen = { href: PAKETE_ANLEGEN_URL, text: "Pakete anlegen" };
    }
    if (s.wirksam && !s.pakete.basis) einstellungen = { href: PAKETE_ANLEGEN_URL, text: "Pakete anlegen" };
  }

  return {
    angeboten,
    text,
    grund,
    schalter,
    einstellungen,
    gesperrtHinweis: e.gesperrt ? "Diese Version ist gesperrt. Für andere Pakete braucht es eine neue Version." : null,
    tagespreise: tagespreiseZeile(e),
  };
}
