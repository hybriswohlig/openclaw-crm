/**
 * Vertrag für Plan 5 (CRM-Neubau): Pakete, Stunden-KV, Tagespreise,
 * Kottke-KV mit Version, Annahme-Restfenster.
 *
 * Vertrag, vom Koordinator vorab committet (5a und 5b zusammen;
 * Teil 5a nutzt nur den Abschnitt „5a“). Kompiliert gegen
 * main c2579d18.
 *
 * Rein: keine Datenbank, kein Rechner, kein Netz. Das CRM rechnet hier keine
 * Preise, es wählt nur aus Preisen, die der Rechner in die gesperrte Version
 * geschrieben hat, und prüft Regeln. Beträge in der Version sind Euro (wie
 * `kv_items` und `package_prices` heute), Beträge an Quotation, Portal und
 * Annahme sind Cent.
 */
import type { Uebersteuerung } from "@/lib/kalkulation-versionen";
import type { HebelArt, KvPosten } from "@/services/rechner/kv-posten";

const inCent = (eur: number) => Math.round(eur * 100);
const postenCent = (p: readonly KvPosten[]) => p.reduce((s, x) => s + inCent(x.unitRate) * x.quantity, 0);

// ════════════════════════════════════════════════════════════════════════
// 5a: Kottke-KV mit Version (Job-Register) und Annahme-Restfenster
// ════════════════════════════════════════════════════════════════════════

/** Zeile in `document_render_jobs` (Migration 0060). */
export type RenderJobStatus = "laeuft" | "abgelegt" | "verworfen" | "fehler";

export interface RenderJob {
  vpsJobId: string;
  workspaceId: string;
  dealRecordId: string;
  /** Wie `store-as-document` heute: "quotation", "order_confirmation", "invoice". */
  documentType: string;
  /** Nur beim KV: Version der Quotation in genau der Lesung, aus der die Preise kamen. */
  calculationVersionId: string | null;
  priceCents: number | null;
  status: RenderJobStatus;
  createdBy: string | null;
  createdAt: string;
  /** Reservierung beim Abschließen (Browser oder Cron), 2 Minuten gültig. */
  claimedAt: string | null;
  storedAt: string | null;
  dealDocumentId: string | null;
  fehler: string | null;
}

export const RENDER_JOB_RESERVIERUNG_MS = 2 * 60 * 1000;
/** Jobs, die so lange nicht fertig wurden, setzt der Cron auf „fehler“. */
export const RENDER_JOB_ABLAUF_MS = 24 * 60 * 60 * 1000;

export type JobAbschluss =
  | { status: "abgelegt"; dealDocumentId: string }
  | { status: "laeuft" }
  | { status: "schon_erledigt"; dealDocumentId: string | null }
  | { status: "verworfen"; grund: "version_veraltet" }
  | { status: "fehler"; fehler: string };

/**
 * Wie ein fertiges VPS-Ergebnis abgelegt wird. KV mit Version: nur, wenn die
 * Quotation beim Ablegen noch genau diese Version trägt, sonst verwerfen
 * (Entscheidung 5a-4). KV ohne Version (Altbestand) und alle anderen Arten:
 * wie heute ohne Bezug.
 */
export function jobAblage(
  job: Pick<RenderJob, "documentType" | "calculationVersionId">,
  quotationVersionId: string | null
): "mit_version" | "ohne_version" | "verwerfen" {
  if (job.documentType !== "quotation" || job.calculationVersionId === null) return "ohne_version";
  return job.calculationVersionId === quotationVersionId ? "mit_version" : "verwerfen";
}

/** Darf ein reservierter Job jetzt abgeschlossen werden? */
export function jobReservierbar(job: Pick<RenderJob, "status" | "claimedAt">, jetzt: Date): boolean {
  if (job.status !== "laeuft") return false;
  if (job.claimedAt === null) return true;
  return jetzt.getTime() - new Date(job.claimedAt).getTime() >= RENDER_JOB_RESERVIERUNG_MS;
}

/**
 * Passt das neueste KV-PDF zur Quotation? Quotation ohne Version: Regel von
 * heute („ohne_version“, Annahme erlaubt). Mit Version: nur ein PDF genau
 * dieser Version gilt, sonst „veraltet“ (Annahme gesperrt, Portal ohne PDF).
 */
export type KvStand = "passt" | "veraltet" | "ohne_version";

export function kvStand(
  quotationVersionId: string | null,
  neuestesKv: { calculationVersionId: string | null } | null
): KvStand {
  if (quotationVersionId === null) return "ohne_version";
  return neuestesKv?.calculationVersionId === quotationVersionId ? "passt" : "veraltet";
}

/** Neuer Ablehnungscode der Annahme (409, steht in `NEU_LADEN_BEI`). [Kunde] */
export const KV_VERALTET = "kv_veraltet" as const;
/** Entwurf der Kundentexte; endgültig prüft Opus (Task 5a-A). */
export const KV_VERALTET_TEXT = {
  sie: "Ihr Angebot wird gerade aktualisiert. Bitte laden Sie die Seite in ein paar Minuten neu.",
  du: "Dein Angebot wird gerade aktualisiert. Bitte lade die Seite in ein paar Minuten neu.",
} as const;

/** Zustand des KV auf der Kalkulationsseite (gesperrte Version). */
export type KvErzeugung =
  | { art: "keins" }
  | { art: "laeuft"; seit: string }
  | { art: "fertig"; dealDocumentId: string; fileName: string }
  | { art: "verworfen" }
  | { art: "fehler"; text: string };

/** Verwaiste Zeilen-Übersteuerung (Fahrzeug-Schlüssel mit anderer Station oder Klasse). */
export interface VerwaisteUebersteuerung {
  id: string;
  key: string;
  /** Schlüssel derselben Klasse und desselben Teils an einer anderen Station (Angebot „übertragen“). */
  kandidaten: string[];
}

const FAHRZEUG_KEY = /^fahrzeug\.([^@.]+)@([^.]+)\.([a-z_]+)$/;

/**
 * Wirksame `zeile`-Übersteuerungen (letzte Nennung je Schlüssel, nicht
 * gelöscht), deren Schlüssel im Ergebnis fehlt. Ohne Treffer leer.
 */
export function verwaisteZeilenUebersteuerungen(
  overrides: readonly Uebersteuerung[],
  posten: readonly { key?: string }[]
): VerwaisteUebersteuerung[] {
  const letzte = new Map<string, Uebersteuerung>();
  for (const u of overrides) if (u.art === "zeile") letzte.set(u.key, u);
  const vorhanden = new Set(posten.map((p) => p.key).filter((k): k is string => typeof k === "string"));
  const aus: VerwaisteUebersteuerung[] = [];
  for (const u of letzte.values()) {
    if (u.wert === null || vorhanden.has(u.key)) continue;
    const m = FAHRZEUG_KEY.exec(u.key);
    const kandidaten = m
      ? [...vorhanden].filter((k) => {
          const n = FAHRZEUG_KEY.exec(k);
          return n !== null && n[1] === m[1] && n[3] === m[3] && n[2] !== m[2];
        }).sort()
      : [];
    aus.push({ id: u.id, key: u.key, kandidaten });
  }
  return aus;
}

// ════════════════════════════════════════════════════════════════════════
// 5b: Pakete, Stunden-KV, Tagespreise
// ════════════════════════════════════════════════════════════════════════

export type PreisModus = "fest" | "stunden";

/** Neue Übersteuerungsarten (B3 nimmt sie in `UebersteuerungsArt` auf). Keine geht an den Rechner außer `preismodus`. */
export type NeueUebersteuerungsArt = "paketpreis" | "tagespreis" | "kv_darstellung" | "preismodus";
/**
 * Schlüssel: paketpreis `<slug>`, wert `{ betrag: number }` (Euro);
 * tagespreis `<YYYY-MM-DD>` oder `<YYYY-MM-DD>:<slug>`, wert `{ betrag: number }`;
 * kv_darstellung `kv`, wert `"ein_posten" | "posten"`; preismodus `modus`, wert `PreisModus`.
 */
export type NeuerUebersteuerungsWert = { betrag: number } | "ein_posten" | "posten" | PreisModus;

/** Additive Rechner-Anfragefelder (alle als Text wie `paket_hebel`). */
export interface RechnerAnfragePlan5 {
  /** JSON-Liste `YYYY-MM-DD`, höchstens 42 Einträge. */
  tage?: string;
  stunden_modus?: "1";
  /** Personal-, Gemeinkosten- und Versicherungs-Übersteuerungen gelten auch in Paketen. */
  paket_uebersteuerungen?: "1";
  /** Zeilen-Übersteuerung `fahrzeug.<klasse>.miete|tagespauschale` gilt an jeder Station. */
  zeilen_stabil?: "1";
}

/** Additive Rechner-Antwortfelder. Fehlen sie, arbeitet das CRM wie heute. */
export interface RechnerPaketpreisPlan5 {
  slug: string;
  festpreis: number | null;
  selbstkosten: number;
  hinweis?: string;
  rundungEur?: number;
  margeProzent?: number;
}

export interface RechnerTagespreis {
  datum: string;
  wochentag: "mo" | "di" | "mi" | "do" | "fr" | "sa" | "so";
  feiertag: boolean;
  festpreis: number | null;
  selbstkosten: number;
  margeProzent: number | null;
  gruende: { text: string; punkte: number }[];
  /** Nur mit `paket_hebel`. */
  paketpreise: RechnerPaketpreisPlan5[] | null;
}

export interface RechnerStunden {
  helfer: number;
  transporter: number;
  /** In halben Stunden gerundet. */
  stundenGeschaetzt: number;
  mindestStunden: number;
  satzHelferEur: number;
  satzTransporterEur: number;
  /** Feste Zusatzposten (Halteverbot, Material, Entsorgung, Anfahrtsgeld) in Euro. */
  zusatzposten: { key: string; bezeichnung: string; betrag: number }[];
  summeGeschaetztEur: number;
  mindestbetragEur: number;
}

export interface RechnerErgebnisPlan5 {
  paketpreise?: RechnerPaketpreisPlan5[];
  tagespreise?: RechnerTagespreis[];
  stunden?: RechnerStunden | null;
}

/** Eintrag in `deal_calculation_versions.package_prices` ab 5b (alte Einträge haben nur slug, festpreis, selbstkosten). */
export interface PaketpreisVersion extends RechnerPaketpreisPlan5 {
  /** Rechnerwert vor einer Paketpreis-Übersteuerung; `festpreis` ist der wirksame Preis. */
  rechnerFestpreis?: number | null;
  uebersteuert?: { betrag: number; grund: string } | null;
  /** Posten dieses Pakets am Basistag, Summe = festpreis (beim Sperren gesetzt). */
  kvItems?: KvPosten[];
}

export interface TagesSlot {
  label: string;
  startTime: string | null;
  endTime: string | null;
}

/** Eintrag in `deal_calculation_versions.day_prices` (Migration 0061). */
export interface Tagespreis {
  datum: string;
  wochentag: RechnerTagespreis["wochentag"];
  feiertag: boolean;
  festpreis: number | null;
  rechnerFestpreis: number | null;
  selbstkosten: number;
  margeProzent: number | null;
  gruende: { text: string; punkte: number }[];
  uebersteuert: { betrag: number; grund: string } | null;
  paketpreise: PaketpreisVersion[] | null;
  kvItems?: KvPosten[];
  slots: TagesSlot[];
  note: string | null;
  empfohlen: boolean;
  /** Meilenstein 3, bis dahin immer null. */
  vehicleBookingId: null;
}

/** Stunden-Angaben in `quotations.document_details.stunden` (kein neues Feld, `quantity` bleibt ganzzahlig). */
export interface StundenAngebot {
  helfer: number;
  transporter: number;
  stundenGeschaetzt: number;
  mindestStunden: number;
  satzHelferEur: number;
  satzTransporterEur: number;
  summeGeschaetztCent: number;
  mindestbetragCent: number;
  quelle: "version";
}

/** Was eine gesperrte Version an Kundenpreisen trägt. */
export interface VersionsPreise {
  pricingMode: PreisModus;
  priceCents: number | null;
  kvItems: KvPosten[];
  packagePrices: PaketpreisVersion[];
  dayPrices: Tagespreis[];
}

export interface AngebotsWahl {
  paketSlug: string | null;
  datum: string | null;
}

/**
 * Preis und Posten für eine Wahl aus der gesperrten Version. Tag vor Paket:
 * mit Tag und Paket der Paketpreis an diesem Tag, mit Tag allein der
 * Tagespreis, mit Paket allein der Paketpreis am Basistag, sonst der
 * Hauptpreis. null, wenn die Wahl keinen Preis hat (nicht kalkulierbar oder
 * nicht angeboten).
 */
export function wahlPreis(v: VersionsPreise, w: AngebotsWahl): { priceCents: number; kvItems: KvPosten[] } | null {
  const tag = w.datum === null ? null : v.dayPrices.find((t) => t.datum === w.datum) ?? null;
  if (w.datum !== null && tag === null) return null;
  if (tag) {
    if (w.paketSlug !== null && tag.paketpreise) {
      const p = tag.paketpreise.find((x) => x.slug === w.paketSlug);
      return p && p.festpreis !== null ? { priceCents: inCent(p.festpreis), kvItems: p.kvItems ?? [] } : null;
    }
    return tag.festpreis === null ? null : { priceCents: inCent(tag.festpreis), kvItems: tag.kvItems ?? [] };
  }
  if (w.paketSlug !== null) {
    const p = v.packagePrices.find((x) => x.slug === w.paketSlug);
    return p && p.festpreis !== null ? { priceCents: inCent(p.festpreis), kvItems: p.kvItems ?? [] } : null;
  }
  return v.priceCents === null ? null : { priceCents: v.priceCents, kvItems: v.kvItems };
}

/** Wahl, die Quotation und Versions-Kapsel zeigen: empfohlenes Paket am empfohlenen (sonst ersten) Tag. */
export function standardWahl(v: Pick<VersionsPreise, "dayPrices">, empfohlenesPaket: string | null): AngebotsWahl {
  const tag = v.dayPrices.find((t) => t.empfohlen) ?? v.dayPrices[0] ?? null;
  return { paketSlug: empfohlenesPaket, datum: tag?.datum ?? null };
}

/** Alle Kundenpreise der Version in fester Reihenfolge (für Sperr-Hash und Anzahlungsprüfung). */
export function alleKundenpreise(v: VersionsPreise): { paketSlug: string | null; datum: string | null; cent: number | null }[] {
  const aus: { paketSlug: string | null; datum: string | null; cent: number | null }[] = [
    { paketSlug: null, datum: null, cent: v.priceCents },
  ];
  for (const p of [...v.packagePrices].sort((a, b) => a.slug.localeCompare(b.slug))) {
    aus.push({ paketSlug: p.slug, datum: null, cent: p.festpreis === null ? null : inCent(p.festpreis) });
  }
  for (const t of [...v.dayPrices].sort((a, b) => a.datum.localeCompare(b.datum))) {
    aus.push({ paketSlug: null, datum: t.datum, cent: t.festpreis === null ? null : inCent(t.festpreis) });
    for (const p of [...(t.paketpreise ?? [])].sort((a, b) => a.slug.localeCompare(b.slug))) {
      aus.push({ paketSlug: p.slug, datum: t.datum, cent: p.festpreis === null ? null : inCent(p.festpreis) });
    }
  }
  return aus;
}

/**
 * Lesbarer, deterministischer Schlüssel über alle Kundenpreise. Die Seite
 * schickt ihn als `erwartetPreisHash` beim Sperren; weicht er nach der
 * Neuberechnung ab, antwortet `sperren` mit PREIS_GEAENDERT.
 */
export function preisHash(v: VersionsPreise): string {
  return alleKundenpreise(v)
    .map((e) => `${e.paketSlug ?? "-"}@${e.datum ?? "-"}=${e.cent ?? "x"}`)
    .join("|");
}

/** Posten gleich, Zeile für Zeile: Text (getrimmt), Menge und Einzelpreis auf den Cent. */
function gleichePosten(a: readonly KvPosten[], b: readonly KvPosten[]): boolean {
  return (
    a.length === b.length &&
    a.every(
      (x, i) =>
        x.description.trim() === b[i].description.trim() && x.quantity === b[i].quantity && inCent(x.unitRate) === inCent(b[i].unitRate)
    )
  );
}

/**
 * Ist die Quotation genau eine Wahl dieser Version (Kundenwahl, nicht von
 * Hand geändert)? Nutzen `kvAusVersion`, `angebotGeaendert` und die Annahme.
 *
 * F2 (Review I1), additiv erweitert: Verglichen werden Festpreis und die
 * Posten Zeile für Zeile (Text, Menge, Einzelpreis), nicht nur Summen. Mit
 * `wahl` zählt nur diese eine Wahl (die aktuelle der Quotation: Paket der
 * gewählten gebundenen Option, gewählter Tag; wie `kundenwahlAnwenden`). Ohne
 * `wahl` zählt jede Wahl der Version; das bleibt nur für Aufrufer ohne
 * Kundenwahl (Tests, Werkzeuge) und reicht nicht, um eine Handänderung
 * auszuschließen: ein von Hand gesetzter Preis, der zufällig einer anderen
 * Wahl gleicht, sähe sonst wie eine Kundenwahl aus.
 */
export function angebotPasstZuVersion(
  q: { fixedPriceCents: number | null; posten: readonly KvPosten[] },
  v: VersionsPreise,
  wahl?: AngebotsWahl
): boolean {
  if (q.fixedPriceCents === null || postenCent(q.posten) !== q.fixedPriceCents) return false;
  const kandidaten: AngebotsWahl[] = [];
  if (wahl) kandidaten.push(wahl);
  else {
    kandidaten.push({ paketSlug: null, datum: null });
    for (const p of v.packagePrices) kandidaten.push({ paketSlug: p.slug, datum: null });
    for (const t of v.dayPrices) {
      kandidaten.push({ paketSlug: null, datum: t.datum });
      for (const p of t.paketpreise ?? []) kandidaten.push({ paketSlug: p.slug, datum: t.datum });
    }
  }
  return kandidaten.some((w) => {
    const r = wahlPreis(v, w);
    return r !== null && r.priceCents === q.fixedPriceCents && gleichePosten(q.posten, r.kvItems);
  });
}

/** Kern-Regel „kein Posten wird Pauschale“ (Entscheidung 5b-6). Der Kern ist der erste Posten. */
export const KERN_WARN_ANTEIL = 0.5;
export type KernBefund = { art: "ok" } | { art: "klein"; anteil: number } | { art: "negativ" } | { art: "ein_posten" };

export function kernBefund(posten: readonly KvPosten[]): KernBefund {
  if (posten.length <= 1) return { art: "ein_posten" };
  const summe = postenCent(posten);
  const kern = inCent(posten[0].unitRate) * posten[0].quantity;
  if (kern <= 0 || summe <= 0) return { art: "negativ" };
  const anteil = kern / summe;
  return anteil < KERN_WARN_ANTEIL ? { art: "klein", anteil } : { art: "ok" };
}

/** Hebel, die ein Paket behält; Basis ohne Hebel ist erlaubt, andere aktive Pakete mit `[]` sperren nicht. */
export function paketOhneHebelSperrt(p: { slug: string; hebel: readonly HebelArt[] }): boolean {
  return p.hebel.length === 0 && p.slug !== "basis";
}

/** Anzahlung als fester Betrag (Entscheidung 5b-14): jeder angebotene Preis muss darüber liegen. */
export function anzahlungPasst(depositCents: number | null, v: VersionsPreise): boolean {
  if (depositCents === null || depositCents <= 0) return true;
  return alleKundenpreise(v).every((e) => e.cent === null || e.cent > depositCents);
}

/** Neue fachliche Fehler beim Sperren (B3 nimmt sie in `VersionsFehlerCode` auf, alle 409). */
export type Plan5FehlerCode =
  | "KERN_NEGATIV"
  | "PAKET_OHNE_PREIS"
  | "PAKET_OHNE_HEBEL"
  | "UEBERSTEUERUNG_VERWAIST"
  | "ANZAHLUNG_UEBER_PREIS"
  | "STUNDEN_NUR_MENSCH"
  | "STUNDEN_ZUSATZ_VPS"
  | "STUNDEN_TRANSPORTER_VPS"
  | "MODUSWECHSEL"
  | "TAGESPREIS_NUR_MENSCH";

export const PLAN5_FEHLER_TEXT: Record<Plan5FehlerCode, string> = {
  KERN_NEGATIV: "Die Hebel sind größer als der Preis. Bitte Marge oder Hebel prüfen.",
  PAKET_OHNE_PREIS: "Ein Paket hat keinen Preis. Bitte den Paketpreis mit Grund eintragen oder das Paket entfernen.",
  PAKET_OHNE_HEBEL: "Für ein Paket sind keine Leistungen hinterlegt. Bitte in den Portal-Einstellungen die Hebel des Pakets setzen.",
  UEBERSTEUERUNG_VERWAIST: "Eine Anpassung wirkt nicht mehr, weil die Kostenzeile weg ist. Bitte übertragen oder verwerfen.",
  ANZAHLUNG_UEBER_PREIS: "Ein angebotener Preis liegt nicht über der Anzahlung. Bitte die Anzahlung anpassen.",
  STUNDEN_NUR_MENSCH: "Einen Stunden-KV sperrt nur ein Mensch.",
  STUNDEN_ZUSATZ_VPS: "Stunden-KV mit festen Zusatzposten geht für Kottke noch nicht. Bitte ohne Zusatzposten oder als Festpreis.",
  STUNDEN_TRANSPORTER_VPS: "Stunden-KV für Kottke geht nur mit genau einem Transporter. Bitte als Festpreis anbieten.",
  MODUSWECHSEL: "Das Angebot ist ein Stunden-KV. Bitte bestätigen, dass es ein Festpreis werden soll.",
  TAGESPREIS_NUR_MENSCH: "Tagespreise legt nur ein Mensch im Termin-Dialog fest.",
};

/** Schalter je Firma (`operating_company_portal_settings`, Migration 0061). */
export interface Plan5Schalter {
  angebotAusKalkulation: boolean;
  tagespreise: boolean;
}

/** Terminangebot mit Preis, wie es das Portal bekommt (additiv zu `DateOfferOption`). */
export interface TerminangebotPreis {
  dateOfferId: string;
  datum: string;
  priceCents: number | null;
  /** Preis je Paket-Slug an diesem Tag, null ohne Pakete. */
  packagePrices: Record<string, number> | null;
}

/** Raster des Termin-Dialogs (Antwort von `POST …/versions/[v]/tage`, nichts gespeichert). */
export interface TagesRasterZelle {
  datum: string;
  wochentag: RechnerTagespreis["wochentag"];
  feiertag: boolean;
  /** Preis des empfohlenen Pakets, sonst Hauptpreis; null ohne Preis. */
  preisCent: number | null;
  gruende: { text: string; punkte: number }[];
  auftraege: { dealId: string; name: string }[];
  vergangen: boolean;
}

export interface TagesRaster {
  von: string;
  bis: string;
  zellen: TagesRasterZelle[];
  wunschtermin: { datum: string | null; quelle: "deal" | "portal" | null; weitere: string[] };
  hinweis: string | null;
}

/** Eingabe von „Tage anbieten“ (`PUT …/versions/[v]/tage`, nur Entwurf). */
export interface TageAnbieten {
  tage: { datum: string; slots: TagesSlot[]; note: string | null; empfohlen: boolean }[];
  uebersteuerungen: { datum: string; paketSlug: string | null; betrag: number; grund: string }[];
}
