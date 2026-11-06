/**
 * Umzugsakte (Plan 3, Task 8), reine Logik: Kopf, die sechs Kacheln der
 * Zahlenreihe, die Dock-Regeln und die Form der Akte-Daten. Kein
 * Datenbankzugriff; geladen wird in `services/akte.ts`.
 *
 * Entscheidung 13: Kachel 6 ist gold nur bei `waiting_on = 'uns'`, grau bei
 * `kunde`, jade „Läuft“ bei `niemand`; bei Verloren und Kein Lead grau
 * „Wartet · – · abgeschlossen“ (Review Task 15). Kachel 3 heißt „Termin“. Anzeige
 * deutsch in Europe/Berlin, Trenner „·“; „–“ steht als Platzhalter für einen
 * fehlenden Wert (Vorgabe der Spec), nie als Gedankenstrich im Satz.
 */
import { bewertungAngefragt, bewertungGesperrt, inTagen, type AblaufFakten, type AblaufSchritt } from "@/lib/ablauf";
import { euroText, tagKurz, volumenText } from "@/lib/anzeige";
import { alsIso } from "@/lib/db-werte";
import { KEIN_LEAD_STAGE_CATEGORY } from "@/lib/kontaktart";
import type { NachfassModus } from "@/lib/nachfass-schalter";
import type { Zahlungsmeldung } from "@/lib/zahlungsmeldungen";

// ─── Typen ────────────────────────────────────────────────────────────────────

export interface Kachel {
  key: "kv" | "marge" | "termin" | "volumen" | "team" | "wartet";
  label: string;
  wert: string;
  zeile: string;
  ton?: "gold" | "grau" | "jade";
}

export type DockAktion =
  | "nachfass_senden"
  | "zahlung_bestaetigen"
  | "kv_erstellen"
  | "ab_erstellen"
  | "rechnung_erstellen"
  | "zahlung_erfassen"
  | "bewertung_anfragen"
  | "nachricht_schreiben";

export interface Wartet {
  waitingOn: "uns" | "kunde" | "niemand" | null;
  waitingSince: string | null;
  waitingReason: string | null;
}

export interface DockEingabe {
  offenerNachfassEntwurf: { id: string; gespraechId: string } | null;
  einzigeMeldung: string | null;
  hatKanal: boolean;
}

export interface Dock {
  primaer: { aktion: DockAktion; label: string; ziel?: string };
  abErlaubt: boolean;
  rechnungErlaubt: boolean;
  /** Schritt 11 anbietbar: Durchgeführt oder Bezahlt, noch nicht angefragt, nicht gesperrt. */
  bewertungErlaubt: boolean;
}

export type StufenTon = "blau" | "gold" | "jade" | "grau";

export interface AkteDaten {
  kopf: {
    name: string;
    art: string;
    strecke: string;
    meta: string;
    team: { kuerzel: string; name: string }[];
    stufe: { id: string | null; label: string; kategorie: string | null; ton: StufenTon };
    stufen: { id: string; label: string; kategorie: string | null }[];
    verlustGruende: { id: string; label: string }[];
    /** Gespeicherter Verlustgrund (Options-ID), damit Verloren nicht erneut fragt. */
    verlustGrund: string | null;
  };
  kacheln: Kachel[];
  ablauf: { schritte: AblaufSchritt[]; position: number };
  nachfass: { an: boolean; modus: NachfassModus; text: string };
  dock: Dock;
  zahlung: { restCent: number | null; meldungen: Zahlungsmeldung[] };
  firma: { id: string | null; name: string | null };
  altLink: string;
  /** Neue Kalkulationsseite des Deals (Plan 4, Entscheidung 1). */
  kalkulationLink: string;
  /** Ziel von „KV anpassen“ und „KV erstellen“: die Kalkulationsseite, bei Paketoptionen oder Stunden-KV der alte Angebots-Tab. */
  kvLink: string;
}

/**
 * Verweise der Akte auf die Kalkulation. „Kalkulation öffnen“ geht immer auf die neue Seite.
 * „KV anpassen/erstellen“ bleibt bei Paketoptionen und Stunden-KV auf dem alten
 * Angebots-Tab, weil Sperren dort bis Plan 5 abgelehnt wird (Entscheidung 1).
 */
export function kalkulationLinks(
  deal: string,
  altLink: string,
  kv: { hatPaketoptionen: boolean; istStunden: boolean }
): { kalkulationLink: string; kvLink: string } {
  const kalkulationLink = `/app/leads/${deal}/kalkulation`;
  const alt = `${altLink}${altLink.includes("?") ? "&" : "?"}tab=quotation`;
  return { kalkulationLink, kvLink: kv.hatPaketoptionen || kv.istStunden ? alt : kalkulationLink };
}

// ─── Kleine Helfer ────────────────────────────────────────────────────────────

/** Platzhalter für einen fehlenden Wert in einer Kachel. */
const LEER = "–";

type Teil = string | null | undefined | false;

/** Teile ohne Wert entfallen samt Trenner. */
function teile(...xs: Teil[]): string {
  return xs.filter((x): x is string => typeof x === "string" && x !== "").join(" · ");
}

const KOMMA1 = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 1 });
const GANZ = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 0 });

/** „und“ vor dem letzten Teil: „A“, „A und B“, „A, B und C“. */
function aufzaehlung(xs: string[]): string {
  if (xs.length <= 1) return xs.join("");
  return `${xs.slice(0, -1).join(", ")} und ${xs[xs.length - 1]}`;
}

// ─── Zahlenreihe ──────────────────────────────────────────────────────────────

function kvKachel(f: AblaufFakten): Kachel {
  const label = "Kostenvoranschlag";
  const kv = f.kv;
  if (!kv) return { key: "kv", label, wert: LEER, zeile: "noch kein KV" };
  const wert = kv.istStunden ? "Stunden-KV" : kv.betragCent !== null ? euroText(kv.betragCent) : LEER;
  const zeile = teile(
    kv.version !== null && `v${kv.version}`,
    kv.gesendetAm ? `gesendet ${tagKurz(kv.gesendetAm)}` : "noch nicht gesendet"
  );
  return { key: "kv", label, wert, zeile };
}

function margeKachel(f: AblaufFakten): Kachel {
  const k = f.kalkulation;
  if (!k) return { key: "marge", label: "Marge", wert: LEER, zeile: "noch keine Kalkulation" };
  return {
    key: "marge",
    label: "Marge",
    wert: k.margeProzent !== null ? `${GANZ.format(k.margeProzent)} %` : LEER,
    zeile: k.selbstkostenCent !== null ? `Selbstkosten ${euroText(k.selbstkostenCent)}` : "",
  };
}

function terminKachel(f: AblaufFakten, jetzt: Date): Kachel {
  if (!f.termin) return { key: "termin", label: "Termin", wert: LEER, zeile: "kein Termin" };
  return { key: "termin", label: "Termin", wert: tagKurz(f.termin.datum), zeile: inTagen(f.termin.datum, jetzt) };
}

function volumenKachel(f: AblaufFakten, herkunft: string | null): Kachel {
  if (f.volumenCbm === null || f.volumenCbm <= 0) return { key: "volumen", label: "Volumen", wert: LEER, zeile: "noch offen" };
  return { key: "volumen", label: "Volumen", wert: volumenText(f.volumenCbm), zeile: herkunft ?? "" };
}

function teamKachel(f: AblaufFakten): Kachel {
  if (f.team.personen <= 0) return { key: "team", label: "Team", wert: LEER, zeile: "noch kein Team" };
  const e = f.einsatz;
  return {
    key: "team",
    label: "Team",
    wert: teile(String(f.team.personen), e?.fahrzeug),
    zeile: teile(e?.fahrtH != null && `Fahrt ${KOMMA1.format(e.fahrtH)} h`, e?.arbeitH != null && `Arbeit ${KOMMA1.format(e.arbeitH)} h`),
  };
}

/** „35 Min“, „5 Std“, „1 Tag“, „2 Tage“; Zukunft zählt als 0, ungültig → null. */
function dauerSeit(seit: string, jetzt: Date): string | null {
  const iso = alsIso(seit);
  if (!iso) return null;
  const min = Math.max(0, Math.floor((jetzt.getTime() - Date.parse(iso)) / 60_000));
  if (min < 60) return `${min} Min`;
  const std = Math.floor(min / 60);
  if (std < 24) return `${std} Std`;
  const tage = Math.floor(std / 24);
  return tage === 1 ? "1 Tag" : `${tage} Tage`;
}

const WARTET_KOPF: Record<"uns" | "kunde" | "niemand", { label: string; ton: NonNullable<Kachel["ton"]> }> = {
  uns: { label: "Wartet auf uns", ton: "gold" },
  kunde: { label: "Wartet auf Kunden", ton: "grau" },
  niemand: { label: "Läuft", ton: "jade" },
};

/** Ohne Zeile in `deal_workflow_state` wie „niemand“. */
function wartetKachel(w: Wartet, jetzt: Date): Kachel {
  const { label, ton } = WARTET_KOPF[w.waitingOn ?? "niemand"];
  return {
    key: "wartet",
    label,
    wert: (w.waitingSince && dauerSeit(w.waitingSince, jetzt)) || LEER,
    zeile: w.waitingReason ?? "",
    ton,
  };
}

/** Verloren und Kein Lead: nichts läuft, niemand wartet, was auch immer `deal_workflow_state` noch sagt. */
const WARTET_ABGESCHLOSSEN: Kachel = { key: "wartet", label: "Wartet", wert: LEER, zeile: "abgeschlossen", ton: "grau" };

/** Die sechs Kacheln, immer in dieser Reihenfolge. */
export function zahlenreiheAus(f: AblaufFakten, wartet: Wartet, volumenHerkunft: string | null, jetzt: Date): Kachel[] {
  // VERLOREN steht beim Dock weiter unten; zur Laufzeit längst ausgewertet.
  const sechste = VERLOREN.has(f.stageCategory ?? "") ? WARTET_ABGESCHLOSSEN : wartetKachel(wartet, jetzt);
  return [kvKachel(f), margeKachel(f), terminKachel(f, jetzt), volumenKachel(f, volumenHerkunft), teamKachel(f), sechste];
}

/**
 * „aus 14 Fotos und Chat“: Quellen der Inventarteile in fester Reihenfolge
 * (Fotos, Chat, von Hand), sonst „aus der Kalkulation“; ohne Volumen null.
 */
export function volumenHerkunftAus(v: { quelle: "inventar" | "kalkulation" | null; inventarQuellen: readonly string[] }, fotos: number): string | null {
  if (v.quelle === "kalkulation") return "aus der Kalkulation";
  if (v.quelle !== "inventar") return null;
  const q = new Set(v.inventarQuellen);
  const teileListe = [
    q.has("foto") && (fotos > 0 ? (fotos === 1 ? "1 Foto" : `${fotos} Fotos`) : "Fotos"),
    q.has("chat") && "Chat",
    q.has("operator") && "Angaben von Hand",
  ].filter((x): x is string => typeof x === "string");
  return teileListe.length > 0 ? `aus ${aufzaehlung(teileListe)}` : null;
}

// ─── Dock ─────────────────────────────────────────────────────────────────────

const LABEL: Record<DockAktion, string> = {
  nachfass_senden: "Nachfass senden",
  zahlung_bestaetigen: "Zahlung bestätigen",
  kv_erstellen: "KV erstellen",
  ab_erstellen: "AB erstellen",
  rechnung_erstellen: "Rechnung erstellen",
  zahlung_erfassen: "Zahlung erfassen",
  bewertung_anfragen: "Bewertung anfragen",
  nachricht_schreiben: "Nachricht schreiben",
};

const VERLOREN = new Set(["lost", KEIN_LEAD_STAGE_CATEGORY]);
const OFFEN = new Set(["open_new", "open_engaged"]);
const RECHNUNG_STUFEN = new Set(["booked", "done_unpaid", "paid"]);
const NACH_EINSATZ = new Set(["done_unpaid", "paid"]);

function primaer(aktion: DockAktion, ziel?: string | null): Dock["primaer"] {
  return ziel ? { aktion, label: LABEL[aktion], ziel } : { aktion, label: LABEL[aktion] };
}

/** Schritt 10 erledigt: kein Rest mehr oder Stufe Bezahlt (ein unbekannter Rest gilt nicht als erledigt). */
function zahlungErledigt(f: AblaufFakten, stufe: string): boolean {
  return f.rest.restCent === 0 || stufe === "paid";
}

/**
 * Hauptknopf des Docks, erste Regel trifft: Verloren/Kein Lead → Nachricht;
 * Nachfass-Entwurf (nur mit Kanal) → senden; offene Zahlungsmeldung bei nicht
 * erledigtem Schritt 10 → bei genau einer bestätigen (mit Ziel), bei mehreren
 * Zahlung erfassen (Dialog); offene Stufe ohne gesperrte Version → KV; Annahme
 * ohne AB → AB; Durchgeführt ohne Rechnung → Rechnung; Rechnung mit Rest →
 * Zahlung erfassen; Durchgeführt/Bezahlt ohne Bewertungsanfrage → Bewertung
 * (nie nach Beschwerde oder Abmeldung, `complaint_routed`/`suppressed`); sonst
 * Nachricht. `bewertungErlaubt` gilt unabhängig vom Hauptknopf (Knopf im Ablauf).
 */
export function dockAus(f: AblaufFakten, e: DockEingabe): Dock {
  const stufe = f.stageCategory ?? "";
  const abErlaubt = f.annahme !== null;
  const rechnungErlaubt = RECHNUNG_STUFEN.has(stufe);
  const bewertungErlaubt = NACH_EINSATZ.has(stufe) && !bewertungAngefragt(f) && !bewertungGesperrt(f);
  const ergebnis = (p: Dock["primaer"]): Dock => ({ primaer: p, abErlaubt, rechnungErlaubt, bewertungErlaubt });

  if (VERLOREN.has(stufe)) return ergebnis(primaer("nachricht_schreiben"));
  if (e.offenerNachfassEntwurf && e.hatKanal) return ergebnis(primaer("nachfass_senden", e.offenerNachfassEntwurf.id));
  if (f.offeneMeldungen > 0 && !zahlungErledigt(f, stufe)) {
    if (f.offeneMeldungen === 1 && e.einzigeMeldung) return ergebnis(primaer("zahlung_bestaetigen", e.einzigeMeldung));
    return ergebnis(primaer("zahlung_erfassen"));
  }
  if (OFFEN.has(stufe) && f.kalkulation?.status !== "gesperrt") return ergebnis(primaer("kv_erstellen"));
  if (f.annahme && !f.abAm) return ergebnis(primaer("ab_erstellen"));
  if (stufe === "done_unpaid" && !f.rechnung) return ergebnis(primaer("rechnung_erstellen"));
  if (f.rechnung && (f.rest.restCent ?? 0) > 0) return ergebnis(primaer("zahlung_erfassen"));
  if (bewertungErlaubt) return ergebnis(primaer("bewertung_anfragen"));
  return ergebnis(primaer("nachricht_schreiben"));
}

// ─── Kopf ─────────────────────────────────────────────────────────────────────

/** Farbe der Stufen-Pille. */
export function stufenTon(kategorie: string | null): StufenTon {
  if (kategorie === "open_new" || kategorie === "open_engaged") return "blau";
  if (kategorie === "quoted") return "gold";
  if (kategorie && RECHNUNG_STUFEN.has(kategorie)) return "jade";
  return "grau";
}

/** Ort nach der Postleitzahl im Freitext („…, 70178 Stuttgart“ → „Stuttgart“). */
/** Landesname nach dem Ort („Esslingen Deutschland“, „Stuttgart, DE“). */
const LAND_AM_ENDE = /[\s,]+(?:[Dd]eutschland|[Gg]ermany|DEUTSCHLAND|GERMANY|DE)\s*$/;

function ohneLand(ort: string): string | null {
  const ohne = ort.replace(LAND_AM_ENDE, "").trim();
  return ohne ? ohne : null;
}

function ortAusText(text: string): string | null {
  const m = /\b\d{5}\s+([^,]+)/.exec(text);
  const ort = m?.[1]?.trim();
  return ort ? ohneLand(ort) : null;
}

/** Ort einer Adresse: `LocationValue.city`, sonst der Ort nach der Postleitzahl im Freitext. */
export function ortAus(adresse: unknown): string | null {
  if (typeof adresse === "string") return ortAusText(adresse);
  if (!adresse || typeof adresse !== "object" || Array.isArray(adresse)) return null;
  const o = adresse as Record<string, unknown>;
  if (typeof o.city === "string" && o.city.trim()) {
    const ort = ohneLand(o.city.trim());
    if (ort) return ort;
  }
  return typeof o.line1 === "string" ? ortAusText(o.line1) : null;
}

const LEISTUNG_WORT: Record<AblaufFakten["leistung"], string> = {
  move: "Umzug",
  clearance: "Entrümpelung",
  clearance_move: "Entrümpelung und Umzug",
  kitchen_installation: "Küchenmontage",
};

/** „Umzug, 3 Zimmer“; bei Küchenmontage ohne Zimmer. */
export function artAus(leistung: AblaufFakten["leistung"], zimmer: number | null): string {
  const wort = LEISTUNG_WORT[leistung];
  if (leistung === "kitchen_installation" || zimmer === null || !(zimmer > 0)) return wort;
  return `${wort}, ${KOMMA1.format(zimmer)} Zimmer`;
}

/** „Stuttgart-West nach Esslingen“; ohne Ziel nur der Ort, ohne Start „nach Esslingen“. */
export function streckeAus(von: string | null, nach: string | null): string {
  if (von && nach) return `${von} nach ${nach}`;
  if (von) return von;
  if (nach) return `nach ${nach}`;
  return "";
}

/** „Über Kleinanzeigen · Kottke · Lead seit Di 03.11.“ */
export function metaAus(quelle: string | null, firma: string | null, erstelltAm: string): string {
  return teile(quelle && `Über ${quelle}`, firma, `Lead seit ${tagKurz(erstelltAm)}`);
}

/** Erste Buchstaben von Vor- und Nachname („Max Kottke“ → „MK“). */
export function kuerzelAus(name: string): string {
  const woerter = name.trim().split(/\s+/).filter(Boolean);
  if (woerter.length === 0) return "";
  const erster = (w: string) => Array.from(w)[0]?.toLocaleUpperCase("de-DE") ?? "";
  return woerter.length === 1 ? erster(woerter[0]) : erster(woerter[0]) + erster(woerter[woerter.length - 1]);
}
