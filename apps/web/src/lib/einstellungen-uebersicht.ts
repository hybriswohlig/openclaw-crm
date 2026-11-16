/**
 * Plan 13: Einstellungen und Übersicht. Vertrag (rein: keine Datenbank, kein Netz).
 * Ziel im Repo: apps/web/src/lib/einstellungen-uebersicht.ts
 *
 * `ZahlungsregelSpiegel` und `BewertungModusSpiegel` sind Aliase auf die echten Typen
 * aus Plan 9 (`@/lib/geld`) und Plan 11 (`@/lib/bewertungen-kunden`), damit die Namen
 * im Plan stimmen.
 */
import { berlinDateString } from "@/lib/berlin-date";
import { isReadOnlyApiKeyScopes } from "@/lib/api-key-scopes";
import type { BewertungModus } from "@/lib/bewertungen-kunden";
import type { FirmenZahlungsregel } from "@/lib/geld";
import type { StageCategory } from "@/lib/wartet";
import type { ZeitpostenVorlage } from "@/lib/zeitposten";
import type { HebelArt } from "@/services/rechner/kv-posten";

export type Marke = "kottke" | "ceylan";

// ─── Typen aus Plan 9 und 11 ────────────────────────────────────────────────

export type ZahlungsregelSpiegel = FirmenZahlungsregel;
export type BewertungModusSpiegel = BewertungModus;

// ─── Darstellung (user_settings.ansichten.darstellung) ──────────────────────

export const DARSTELLUNG_SCHLUESSEL = "darstellung";
export const DARSTELLUNGEN = ["hell", "dunkel", "system"] as const;
export type Darstellung = (typeof DARSTELLUNGEN)[number];
/** Übersicht S2: folgt dem System. Plan 14 macht den Wert wirksam. */
export const DARSTELLUNG_STANDARD: Darstellung = "system";

export const DARSTELLUNG_LABEL: Record<Darstellung, string> = {
  hell: "Hell",
  dunkel: "Dunkel",
  system: "Wie das Gerät",
};

/** Prüfer für `ANSICHT_PRUEFER` in `PUT /api/v1/me/ansichten/[schluessel]`. */
export function darstellungPruefen(roh: unknown): Darstellung | null {
  return typeof roh === "string" && (DARSTELLUNGEN as readonly string[]).includes(roh) ? (roh as Darstellung) : null;
}

/** Gespeicherter Wert, sonst Standard. */
export function darstellungAus(ansichten: Record<string, unknown> | null | undefined): Darstellung {
  return darstellungPruefen(ansichten?.[DARSTELLUNG_SCHLUESSEL]) ?? DARSTELLUNG_STANDARD;
}

// ─── Kalender-Abo ───────────────────────────────────────────────────────────

/** Volle https-Adresse des Feeds; mit Firma nur deren Einsätze (`?company=`, wie die alte Seite). */
export function kalenderAboUrl(origin: string, pfad: string, firmaId: string | null = null): string {
  const url = new URL(pfad, origin);
  if (firmaId) url.searchParams.set("company", firmaId);
  return url.toString();
}

/** `webcal://` für „In Kalender öffnen“ (Apple, Outlook). */
export function webcalUrl(httpsUrl: string): string {
  return httpsUrl.replace(/^https?:\/\//, "webcal://");
}

// ─── API-Schlüssel (nur lesen) ──────────────────────────────────────────────

/** Ab so vielen Tagen ohne Benutzung gilt ein Schlüssel als ungenutzt. */
export const SCHLUESSEL_UNGENUTZT_TAGE = 30;

export interface ApiSchluesselAnsicht {
  id: string;
  name: string;
  /** Erste Zeichen, nie der Schlüssel. */
  prefix: string;
  zugriff: "voll" | "lesen";
  erstelltAm: string;
  zuletztBenutztAm: string | null;
  laeuftAbAm: string | null;
  abgelaufen: boolean;
  /** Nie benutzt oder länger als `SCHLUESSEL_UNGENUTZT_TAGE` nicht. */
  ungenutzt: boolean;
}

type Zeit = Date | string | null | undefined;
const iso = (z: Zeit): string | null => (z == null ? null : (z instanceof Date ? z : new Date(z)).toISOString());

/** Aus einer Zeile von `listApiKeys` (Hash ist dort nie enthalten). */
export function apiSchluesselAnsicht(
  roh: { id: string; name: string; keyPrefix: string; scopes: unknown; createdAt: Zeit; lastUsedAt: Zeit; expiresAt: Zeit },
  jetzt: Date,
): ApiSchluesselAnsicht {
  const zuletzt = iso(roh.lastUsedAt);
  const ab = iso(roh.expiresAt);
  const grenze = jetzt.getTime() - SCHLUESSEL_UNGENUTZT_TAGE * 86_400_000;
  return {
    id: roh.id,
    name: roh.name,
    prefix: roh.keyPrefix,
    zugriff: isReadOnlyApiKeyScopes(roh.scopes) ? "lesen" : "voll",
    erstelltAm: iso(roh.createdAt) ?? jetzt.toISOString(),
    zuletztBenutztAm: zuletzt,
    laeuftAbAm: ab,
    abgelaufen: ab != null && new Date(ab).getTime() <= jetzt.getTime(),
    ungenutzt: zuletzt == null || new Date(zuletzt).getTime() < grenze,
  };
}

/** „nie benutzt“, „heute“, „gestern“, „vor 5 Tagen“, „am 03.10.2026“ (ab 30 Tagen). Berliner Tage. */
export function zuletztBenutztText(zuletzt: string | null, jetzt: Date): string {
  if (!zuletzt) return "nie benutzt";
  const tag = berlinDateString(new Date(zuletzt));
  const heute = berlinDateString(jetzt);
  const tage = Math.round((Date.parse(`${heute}T00:00:00Z`) - Date.parse(`${tag}T00:00:00Z`)) / 86_400_000);
  if (tage <= 0) return "heute";
  if (tage === 1) return "gestern";
  if (tage < SCHLUESSEL_UNGENUTZT_TAGE) return `vor ${tage} Tagen`;
  const [j, m, t] = tag.split("-");
  return `am ${t}.${m}.${j}`;
}

/** Sortierung der Liste: zuletzt benutzte zuerst, nie benutzte am Ende, dann Name. */
export function apiSchluesselSortieren(a: ApiSchluesselAnsicht, b: ApiSchluesselAnsicht): number {
  if (a.zuletztBenutztAm !== b.zuletztBenutztAm) {
    if (!a.zuletztBenutztAm) return 1;
    if (!b.zuletztBenutztAm) return -1;
    return b.zuletztBenutztAm.localeCompare(a.zuletztBenutztAm);
  }
  return a.name.localeCompare(b.name, "de");
}

// ─── Firmen ─────────────────────────────────────────────────────────────────

/** 403-Text für Firmen-Schalter, die nur Admins ändern (auch Hinweis in der Oberfläche). */
export const NUR_ADMINS = "Nur Admins können das ändern.";

export interface PortalSchalter {
  enabled: boolean;
  signatureEnabled: boolean;
  angebotAusKalkulation: boolean;
  tagespreiseEnabled: boolean;
}

export type PortalSchalterName = "signatureEnabled" | "angebotAusKalkulation" | "tagespreiseEnabled";

/**
 * Patch für `PUT /api/v1/customer-portal-settings/[ocId]`. Tagespreise gibt es nur mit
 * „Angebot aus Kalkulation“ (Plan 5b): Einschalten der Tagespreise ohne diesen Schalter
 * ergibt `null` (nicht erlaubt), Ausschalten von „Angebot aus Kalkulation“ nimmt die
 * Tagespreise mit.
 */
export function portalSchalterPatch(
  aktuell: PortalSchalter,
  name: PortalSchalterName,
  wert: boolean,
): Partial<PortalSchalter> | null {
  if (name === "tagespreiseEnabled" && wert && !aktuell.angebotAusKalkulation) return null;
  if (name === "angebotAusKalkulation" && !wert && aktuell.tagespreiseEnabled) {
    return { angebotAusKalkulation: false, tagespreiseEnabled: false };
  }
  return { [name]: wert };
}

export interface PaketAnsicht {
  id: string;
  slug: string;
  name: string;
  aktiv: boolean;
  hebel: HebelArt[];
}

/** Hebel an- oder abwählen, Reihenfolge wie `PAKET_HEBEL`. */
export function hebelUmschalten(hebel: readonly HebelArt[], h: HebelArt, an: boolean): HebelArt[] {
  const reihenfolge: HebelArt[] = ["halteverbot", "montage", "einpacken", "kueche"];
  const menge = new Set(hebel);
  if (an) menge.add(h);
  else menge.delete(h);
  return reihenfolge.filter((x) => menge.has(x));
}

/** Nächste freie Zeitposten-ID (`zp-1`, `zp-2`, …). */
export function neueZeitpostenId(liste: readonly ZeitpostenVorlage[]): string {
  let n = 1;
  const ids = new Set(liste.map((z) => z.id));
  while (ids.has(`zp-${n}`)) n += 1;
  return `zp-${n}`;
}

/** Ein Satz unter dem Abschnitt Zahlung. Tage nach dem Umzug gibt es nicht. */
export function zahlungsregelText(r: ZahlungsregelSpiegel): string {
  void r.basis;
  void r.tage;
  const ziel =
    "Der Restbetrag ist am Umzugstag fällig, direkt nach dem Umzug. Liegt der Rechnungstag am oder nach dem Umzugstag, ist die Rechnung an dem Tag fällig";
  const erinnerung =
    r.erinnerungModus === "aus"
      ? "Erinnerungen aus."
      : `Erinnerung als Entwurf ${r.erinnerungTage} Tage nach Fälligkeit, zweite ${r.erinnerung2Tage} Tage danach.`;
  return `${ziel}. ${erinnerung}`;
}

export interface FirmaEinstellungenAnsicht {
  id: string;
  name: string;
  marke: Marke | null;
  zahlung: ZahlungsregelSpiegel;
  bewertung: { modus: BewertungModusSpiegel; seit: string | null; hakenPortal: boolean };
  googleReviewUrl: string | null;
  portal: PortalSchalter;
  pakete: PaketAnsicht[];
  zeitposten: ZeitpostenVorlage[];
  /** Plan 12b: Mietanteil einer Transporter-Buchung im Preis (`company_settings.buchung_im_preis`). */
  einsatz: { buchungImPreis: boolean };
}

/** `GET /api/v1/einstellungen`. Firmen und Schlüssel nur für Admins, sonst `null`. */
export interface EinstellungenAntwort {
  ich: { darstellung: Darstellung; kalender: { pfad: string | null; erstelltAm: string | null } };
  admin: boolean;
  firmen: FirmaEinstellungenAnsicht[] | null;
  apiSchluessel: ApiSchluesselAnsicht[] | null;
}

// ─── Rechner, nur lesen ─────────────────────────────────────────────────────

export interface MaterialAnsicht {
  key: string;
  bezeichnung: string;
  einheit: "pauschal" | "m3" | "stueck";
  satz: number;
}

export interface TarifAnsicht {
  id: string;
  version: number;
  marke: Marke | null;
  aktiv: boolean;
  gueltigAb: string | null;
  kommentar: string | null;
  satzArbeit: number | null;
  satzFahrt: number | null;
  stundensatzIntern: number;
  stundensatzVerkauf: number;
  fahrzeugpauschaleVerkaufProTag: number;
  kmSatzVerkauf: number;
  gemeinkostenProzent: number | null;
  versicherungPauschal: number | null;
  rundungEur: number;
  halteverbotVerkauf: number;
  entsorgungProCbmVerkauf: number;
  material: MaterialAnsicht[];
}

export interface StationAnsicht {
  id: string;
  name: string;
  anbieter: string | null;
  adresse: string;
  aktiv: boolean;
  istDepot: boolean;
  wegezeitPersonalMin: number;
}

export interface FahrzeugAnsicht {
  id: string;
  name: string;
  typ: string;
  stationId: string;
  stationName: string | null;
  laderaumCbm: number;
  mietpreisProTag: number | null;
  /** Mo bis So; null = jeden Tag `mietpreisProTag`. */
  mietpreisWochentage: Record<"mo" | "di" | "mi" | "do" | "fr" | "sa" | "so", number> | null;
  inklusivKmProTag: number | null;
  mehrkilometerPreis: number | null;
  tagespauschale: number | null;
  aktiv: boolean;
}

export interface RechnerStammdaten {
  /** Aktiver Tarif, den der Rechner für die Marke nimmt (eigene Zeile, sonst gemeinsame). */
  tarif: Record<Marke, TarifAnsicht | null>;
  /** Alle Versionen, neueste zuerst (nur für „frühere Versionen“). */
  versionen: TarifAnsicht[];
  stationen: StationAnsicht[];
  fahrzeuge: FahrzeugAnsicht[];
  stand: string;
}

export type RechnerStammdatenAntwort = { ok: true; daten: RechnerStammdaten } | { ok: false; fehler: string };

const obj = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
/** Drizzle liefert `numeric` als Text. */
const zahl = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};
const text = (v: unknown): string | null => (typeof v === "string" ? v : null);
const marke = (v: unknown): Marke | null => (v === "kottke" || v === "ceylan" ? v : null);

/** Eine Zeile aus `GET {Rechner}/api/tarife`; `null`, wenn Pflichtfelder fehlen. */
export function tarifAus(roh: unknown): TarifAnsicht | null {
  const z = obj(roh);
  if (!z) return null;
  const id = text(z.id);
  const version = zahl(z.version);
  const pflicht = [z.stundensatzIntern, z.stundensatzVerkauf, z.fahrzeugpauschaleVerkaufProTag, z.kmSatzVerkauf, z.rundungEur, z.halteverbotVerkauf, z.entsorgungProCbmVerkauf].map(zahl);
  if (!id || version == null || pflicht.some((p) => p == null)) return null;
  const [sI, sV, fp, km, rund, hv, ent] = pflicht as number[];
  const material: MaterialAnsicht[] = Array.isArray(z.material)
    ? z.material.flatMap((m) => {
        const o = obj(m);
        const satz = zahl(o?.satz);
        const einheit = o?.einheit;
        if (!o || typeof o.key !== "string" || typeof o.bezeichnung !== "string" || satz == null) return [];
        if (einheit !== "pauschal" && einheit !== "m3" && einheit !== "stueck") return [];
        return [{ key: o.key, bezeichnung: o.bezeichnung, einheit, satz }];
      })
    : [];
  return {
    id,
    version,
    marke: marke(z.marke),
    aktiv: z.aktiv === true,
    gueltigAb: text(z.gueltigAb),
    kommentar: text(z.kommentar),
    satzArbeit: zahl(z.satzArbeit),
    satzFahrt: zahl(z.satzFahrt),
    stundensatzIntern: sI,
    stundensatzVerkauf: sV,
    fahrzeugpauschaleVerkaufProTag: fp,
    kmSatzVerkauf: km,
    gemeinkostenProzent: zahl(z.gemeinkostenProzent),
    versicherungPauschal: zahl(z.versicherungPauschal),
    rundungEur: rund,
    halteverbotVerkauf: hv,
    entsorgungProCbmVerkauf: ent,
    material,
  };
}

/** Wie `aktivenTarifWaehlen` im Rechner (`src/lib/stammdaten.ts:178`): eigene Marke, sonst gemeinsam. */
export function aktiverTarifFuer(tarife: readonly TarifAnsicht[], m: Marke): TarifAnsicht | null {
  const aktive = tarife.filter((t) => t.aktiv);
  return aktive.find((t) => t.marke === m) ?? aktive.find((t) => t.marke === null) ?? null;
}

export function stationAus(roh: unknown): StationAnsicht | null {
  const z = obj(roh);
  const id = text(z?.id);
  const name = text(z?.name);
  const adresse = text(z?.adresse);
  if (!z || !id || !name || adresse == null) return null;
  return {
    id,
    name,
    anbieter: text(z.anbieter),
    adresse,
    aktiv: z.aktiv === true,
    istDepot: z.istDepot === true,
    wegezeitPersonalMin: zahl(z.wegezeitPersonalMin) ?? 0,
  };
}

export function fahrzeugAus(roh: unknown, stationen: readonly StationAnsicht[]): FahrzeugAnsicht | null {
  const z = obj(roh);
  const id = text(z?.id);
  const name = text(z?.name);
  const stationId = text(z?.startortId);
  const laderaum = zahl(z?.laderaumCbm);
  if (!z || !id || !name || !stationId || laderaum == null) return null;
  const wt = obj(z.mietpreisWochentage);
  const tage = ["mo", "di", "mi", "do", "fr", "sa", "so"] as const;
  const wochentage =
    wt && tage.every((t) => zahl(wt[t]) != null)
      ? (Object.fromEntries(tage.map((t) => [t, zahl(wt[t]) as number])) as FahrzeugAnsicht["mietpreisWochentage"])
      : null;
  return {
    id,
    name,
    typ: text(z.typ) ?? "",
    stationId,
    stationName: stationen.find((s) => s.id === stationId)?.name ?? null,
    laderaumCbm: laderaum,
    mietpreisProTag: zahl(z.mietpreisProTag),
    mietpreisWochentage: wochentage,
    inklusivKmProTag: zahl(z.inklusivKmProTag),
    mehrkilometerPreis: zahl(z.mehrkilometerPreis),
    tagespauschale: zahl(z.tagespauschale),
    aktiv: z.aktiv === true,
  };
}

/**
 * Alle drei Antworten des Rechners (`{ tarife }`, `{ startorte }`, `{ fahrzeuge }`) oder ein Fehler.
 * Keine Teilwerte: fehlt eine Liste oder ist eine Zeile unlesbar, gibt es nur den Fehler.
 */
export function stammdatenAus(
  roh: { tarife: unknown; startorte: unknown; fahrzeuge: unknown },
  stand: string,
): RechnerStammdatenAntwort {
  const liste = (v: unknown, k: string): unknown[] | null => {
    const o = obj(v);
    return o && Array.isArray(o[k]) ? (o[k] as unknown[]) : null;
  };
  const t = liste(roh.tarife, "tarife");
  const s = liste(roh.startorte, "startorte");
  const f = liste(roh.fahrzeuge, "fahrzeuge");
  if (!t || !s || !f) return { ok: false, fehler: "Rechner hat unvollständig geantwortet." };
  const tarife = t.map(tarifAus);
  const stationen = s.map(stationAus);
  if (tarife.some((x) => x == null) || stationen.some((x) => x == null)) {
    return { ok: false, fehler: "Rechner-Daten unlesbar." };
  }
  const st = stationen as StationAnsicht[];
  const fahrzeuge = f.map((x) => fahrzeugAus(x, st));
  if (fahrzeuge.some((x) => x == null)) return { ok: false, fehler: "Rechner-Daten unlesbar." };
  const alle = (tarife as TarifAnsicht[]).slice().sort((a, b) => b.version - a.version);
  return {
    ok: true,
    daten: {
      tarif: { kottke: aktiverTarifFuer(alle, "kottke"), ceylan: aktiverTarifFuer(alle, "ceylan") },
      versionen: alle,
      stationen: st.slice().sort((a, b) => a.name.localeCompare(b.name, "de")),
      fahrzeuge: (fahrzeuge as FahrzeugAnsicht[]).slice().sort((a, b) => a.name.localeCompare(b.name, "de")),
      stand,
    },
  };
}

// ─── Übersicht ──────────────────────────────────────────────────────────────

/** Monate je Reihe. */
export const UEBERSICHT_MONATE = 12;

/** `YYYY-MM` aus einem Berliner Tag `YYYY-MM-DD`. */
export const monatAus = (tag: string): string => tag.slice(0, 7);

/** Die letzten `anzahl` Berliner Monate bis einschließlich dem von `heute`, älteste zuerst. */
export function monateBis(heute: string, anzahl: number = UEBERSICHT_MONATE): string[] {
  const [j, m] = heute.split("-").map(Number);
  const aus: string[] = [];
  for (let i = anzahl - 1; i >= 0; i -= 1) {
    const d = new Date(Date.UTC(j, m - 1 - i, 1));
    aus.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  return aus;
}

/** Firmenfilter: `null` = alle Firmen. */
export type FirmaFilter = string | null;
const passt = (firmaId: string | null, filter: FirmaFilter) => filter === null || firmaId === filter;

/** Eine Zahlung. `cent` mit Vorzeichen (Storno-Gegenbuchung aus Plan 9 negativ). */
export interface ZuflussZeile {
  /** `payments.date` (Kalendertag, schon Berlin). */
  tag: string;
  cent: number;
  taxTreatment: string | null;
  /** Schnappschuss `operating_company_id`, sonst Firma des Deals, sonst null (wie `getFinancialOverview`). */
  firmaId: string | null;
}

/** Eingegangen je Monat: alle Zahlungen ohne `nicht_steuerbar` (Kaution), Gegenbuchungen mit. */
export function zuflussJeMonat(zeilen: readonly ZuflussZeile[], monate: readonly string[], firma: FirmaFilter): Record<string, number> {
  const aus = Object.fromEntries(monate.map((m) => [m, 0])) as Record<string, number>;
  for (const z of zeilen) {
    if (z.taxTreatment === "nicht_steuerbar" || !passt(z.firmaId, firma)) continue;
    const m = monatAus(z.tag);
    if (m in aus) aus[m] += z.cent;
  }
  return aus;
}

/**
 * Gleicher Zeitraum im Vormonat für „zum Vormonat“: 1. bis zum selben Tag; ist der
 * Vormonat kürzer, bis zu seinem Ende. `heute` ist ein Berliner Tag `YYYY-MM-DD`.
 */
export function vormonatGleicherZeitraum(heute: string): { von: string; bis: string } {
  const [j, m, t] = heute.split("-").map(Number);
  const anfang = new Date(Date.UTC(j, m - 2, 1));
  const letzter = new Date(Date.UTC(j, m - 1, 0)).getUTCDate();
  const jj = anfang.getUTCFullYear();
  const mm = String(anfang.getUTCMonth() + 1).padStart(2, "0");
  return { von: `${jj}-${mm}-01`, bis: `${jj}-${mm}-${String(Math.min(t, letzter)).padStart(2, "0")}` };
}

/** Eingegangen von `von` bis `bis` (beide einschließlich), gleiche Regeln wie `zuflussJeMonat`. */
export function zuflussZeitraum(zeilen: readonly ZuflussZeile[], von: string, bis: string, firma: FirmaFilter): number {
  let summe = 0;
  for (const z of zeilen) {
    if (z.taxTreatment === "nicht_steuerbar" || !passt(z.firmaId, firma)) continue;
    if (z.tag >= von && z.tag <= bis) summe += z.cent;
  }
  return summe;
}

export const GEWONNEN: readonly StageCategory[] = ["booked", "done_unpaid", "paid"];
export const VERLOREN: readonly StageCategory[] = ["lost"];
export const NOCH_OFFEN: readonly StageCategory[] = ["open_new", "open_engaged", "quoted"];
export const DURCHGEFUEHRT: readonly StageCategory[] = ["done_unpaid", "paid"];

/** Ein Deal für die Übersicht, gebaut in `services/uebersicht.ts`. */
export interface UebersichtDeal {
  id: string;
  /** `records.created_at` als Berliner Tag. */
  angelegtTag: string;
  /** Kategorie wie im Board (`stufeZeileAus`); `kein_lead` und Nicht-Leads zählen nirgends. */
  kategorie: StageCategory | null;
  nichtLead: boolean;
  firmaId: string | null;
  quelle: { id: string; label: string } | null;
  /** `durchfuehrungsTag`. */
  durchgefuehrtTag: string | null;
  /** Auftragswert `offenAus(...).gesamtCent` (Plan 9): Rechnung vor Annahme vor Festpreis; Stunden ohne Rechnung null. */
  auftragCent: number | null;
}

/**
 * Tag der Durchführung: Berliner Tag von `move_completed_at`, sonst `move_date`.
 * Nur für Kategorie Durchgeführt oder Bezahlt, sonst null.
 */
export function durchfuehrungsTag(e: {
  kategorie: StageCategory | null;
  moveCompletedAt: string | null;
  moveDate: string | null;
}): string | null {
  if (!e.kategorie || !DURCHGEFUEHRT.includes(e.kategorie)) return null;
  if (e.moveCompletedAt) return berlinDateString(new Date(e.moveCompletedAt));
  return e.moveDate && /^\d{4}-\d{2}-\d{2}/.test(e.moveDate) ? e.moveDate.slice(0, 10) : null;
}

const zaehlt = (d: UebersichtDeal, firma: FirmaFilter) => !d.nichtLead && d.kategorie !== "kein_lead" && passt(d.firmaId, firma);

export interface DurchgefuehrtMonat {
  cent: number;
  anzahl: number;
  /** Aufträge ohne bekannten Betrag (Stunden-KV ohne Rechnung, kein Angebot). */
  ohneBetrag: number;
}

export function durchgefuehrtJeMonat(deals: readonly UebersichtDeal[], monate: readonly string[], firma: FirmaFilter): Record<string, DurchgefuehrtMonat> {
  const aus = Object.fromEntries(monate.map((m) => [m, { cent: 0, anzahl: 0, ohneBetrag: 0 }])) as Record<string, DurchgefuehrtMonat>;
  for (const d of deals) {
    if (!zaehlt(d, firma) || !d.durchgefuehrtTag) continue;
    const b = aus[monatAus(d.durchgefuehrtTag)];
    if (!b) continue;
    b.anzahl += 1;
    if (d.auftragCent == null) b.ohneBetrag += 1;
    else b.cent += d.auftragCent;
  }
  return aus;
}

export const OHNE_QUELLE = "ohne";

export interface AnfragenReihe {
  /** Quellen mit mindestens einer Anfrage im Zeitraum, häufigste zuerst; „ohne Quelle“ zuletzt. */
  quellen: { id: string; label: string }[];
  je: Record<string, Record<string, number>>;
  gesamt: Record<string, number>;
}

/** Anfragen je Monat (angelegt) und Quelle (`source_channel`). */
export function anfragenJeMonat(deals: readonly UebersichtDeal[], monate: readonly string[], firma: FirmaFilter): AnfragenReihe {
  const je = Object.fromEntries(monate.map((m) => [m, {} as Record<string, number>])) as Record<string, Record<string, number>>;
  const gesamt = Object.fromEntries(monate.map((m) => [m, 0])) as Record<string, number>;
  const summe = new Map<string, { id: string; label: string; n: number }>();
  for (const d of deals) {
    if (!zaehlt(d, firma)) continue;
    const m = monatAus(d.angelegtTag);
    if (!(m in gesamt)) continue;
    const q = d.quelle ?? { id: OHNE_QUELLE, label: "Ohne Quelle" };
    je[m][q.id] = (je[m][q.id] ?? 0) + 1;
    gesamt[m] += 1;
    const s = summe.get(q.id) ?? { ...q, n: 0 };
    s.n += 1;
    summe.set(q.id, s);
  }
  const quellen = [...summe.values()]
    .sort((a, b) => (a.id === OHNE_QUELLE ? 1 : b.id === OHNE_QUELLE ? -1 : b.n - a.n || a.label.localeCompare(b.label, "de")))
    .map(({ id, label }) => ({ id, label }));
  return { quellen, je, gesamt };
}

export interface Abschluss {
  gewonnen: number;
  verloren: number;
  offen: number;
  /** Ganze Prozent gewonnen ÷ (gewonnen + verloren); null ohne entschiedene Anfrage. */
  quoteProzent: number | null;
}

const quote = (g: number, v: number) => (g + v > 0 ? Math.round((g / (g + v)) * 100) : null);

/**
 * Abschlussquote je Anlagemonat (Kohorte) über `stageCategory`, nie über Stufentitel.
 * Deals ohne Kategorie zählen nicht.
 */
export function abschlussJeMonat(
  deals: readonly UebersichtDeal[],
  monate: readonly string[],
  firma: FirmaFilter,
): { je: Record<string, Abschluss>; gesamt: Abschluss } {
  const je = Object.fromEntries(monate.map((m) => [m, { gewonnen: 0, verloren: 0, offen: 0, quoteProzent: null }])) as Record<string, Abschluss>;
  for (const d of deals) {
    if (!zaehlt(d, firma) || !d.kategorie) continue;
    const b = je[monatAus(d.angelegtTag)];
    if (!b) continue;
    if (GEWONNEN.includes(d.kategorie)) b.gewonnen += 1;
    else if (VERLOREN.includes(d.kategorie)) b.verloren += 1;
    else if (NOCH_OFFEN.includes(d.kategorie)) b.offen += 1;
  }
  const gesamt: Abschluss = { gewonnen: 0, verloren: 0, offen: 0, quoteProzent: null };
  for (const b of Object.values(je)) {
    b.quoteProzent = quote(b.gewonnen, b.verloren);
    gesamt.gewonnen += b.gewonnen;
    gesamt.verloren += b.verloren;
    gesamt.offen += b.offen;
  }
  gesamt.quoteProzent = quote(gesamt.gewonnen, gesamt.verloren);
  return { je, gesamt };
}

/** `GET /api/v1/uebersicht?firma=`. */
export interface UebersichtAntwort {
  monate: string[];
  firma: FirmaFilter;
  firmen: { id: string; name: string }[];
  eingegangen: Record<string, number>;
  /** Vergleich der Kachel: Vormonat im gleichen Zeitraum (`vormonatGleicherZeitraum`). */
  vormonat: { bis: string; eingegangen: number };
  durchgefuehrt: Record<string, DurchgefuehrtMonat>;
  anfragen: AnfragenReihe;
  abschluss: { je: Record<string, Abschluss>; gesamt: Abschluss };
  /** Aus `ladeKasse` (Plan 9): Summen der Schlangen „offen“ und „ohne_rechnung“. */
  offen: {
    rest: { anzahl: number; cent: number; unbekannt: number };
    ohneRechnung: { anzahl: number; cent: number; unbekannt: number };
  };
  /** `ladeNavZaehler(ws).heute` (deal_workflow_state), immer alle Firmen. */
  wartetAufUns: number;
  stand: string;
}
