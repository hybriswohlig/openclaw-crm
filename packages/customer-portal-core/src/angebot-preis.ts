/**
 * Plan 5b: Preise je Wahl (Paket, Tag) und Stunden-KV im Portal, in der
 * Annahme, der Bestätigung und der Vertragsmappe. Rein, ohne Node-Typen.
 *
 * Das CRM rechnet hier keine Preise. Alle Beträge kommen aus der gesperrten
 * Version (Paketoptionen, Terminangebote, `document_details.stunden`); hier
 * wird nur gewählt, welcher davon gilt, und wie er heißt.
 */
import { erwarteterGesamtpreis } from "./annahme-recht";
import { hatTagespreise, pickDefaultDealOption, preisAmTag, tagHatPreis, terminPreise } from "./offer-selection";
import type {
  AcceptanceRecord,
  DateOfferOption,
  DateOffersContext,
  DealPackageOffersContext,
  DealPackageOption,
  KvaLineItem,
  KvaSnapshot,
  PortalStundenAngebot,
} from "./types";

// ─── Tag und Preis der Wahl ─────────────────────────────────────────────────

/**
 * Tag, dessen Preise das Portal zeigt: der gewählte, sonst der empfohlene,
 * sonst der erste. null ohne Tagespreise (dann gilt alles wie vor 5b).
 */
export function anzeigeTag(d: DateOffersContext): { tag: DateOfferOption; gewaehlt: boolean } | null {
  if (!hatTagespreise(d.options)) return null;
  const gewaehlt = d.selection ? d.options.find((o) => o.id === d.selection!.dateOfferId) : undefined;
  if (gewaehlt) return { tag: gewaehlt, gewaehlt: true };
  const tag = d.options.find((o) => o.isRecommended) ?? d.options[0];
  return tag ? { tag, gewaehlt: false } : null;
}

export interface PortalPreis {
  /** Betrag für Preiskarte, Mobil-Leiste und Annahmedialog (`expectedTotalCents`). */
  cents: number;
  /** Tag, an dem der Betrag gilt; nur mit Tagespreisen. */
  tag: DateOfferOption | null;
  /** true: vom Kunden gewählt („Preis an diesem Tag“); false: empfohlener Tag. */
  tagGewaehlt: boolean;
}

/**
 * Der Preis, den Stufe 1 zeigt und der Annahmedialog als `expectedTotalCents`
 * schickt. Vor der Annahme über `erwarteterGesamtpreis` (wie der Server, mit
 * dem gewählten Tag; ohne Wahl der empfohlene Tag, dann ist die Annahme mit
 * „date“ gesperrt). Nach der Annahme der angenommene Betrag.
 */
export function angezeigterPreis(ctx: {
  kva: Pick<KvaSnapshot, "totalCents"> | null;
  dealPackageOffers: DealPackageOffersContext;
  dateOffers: DateOffersContext;
  acceptance: Pick<AcceptanceRecord, "confirmedTotalCents"> | null;
}): PortalPreis {
  const anzeige = anzeigeTag(ctx.dateOffers);
  if (ctx.acceptance && ctx.acceptance.confirmedTotalCents > 0) {
    return {
      cents: ctx.acceptance.confirmedTotalCents,
      tag: anzeige?.gewaehlt ? anzeige.tag : null,
      tagGewaehlt: !!anzeige?.gewaehlt,
    };
  }
  const option = pickDefaultDealOption(ctx.dealPackageOffers.options, ctx.dealPackageOffers.selectedOptionId);
  const cents = erwarteterGesamtpreis({
    dealOptions: ctx.dealPackageOffers.options,
    selectedOptionId: option?.id ?? null,
    totalCents: ctx.kva?.totalCents ?? 0,
    dateOffers: terminPreise(ctx.dateOffers.options),
    selectedDateOfferId: anzeige?.tag.id ?? null,
  });
  return { cents, tag: anzeige?.tag ?? null, tagGewaehlt: !!anzeige?.gewaehlt };
}

/**
 * Preis einer Paketkarte: am angezeigten Tag (gewählt, sonst empfohlen), sonst
 * der Optionspreis wie vor 5b. null = das Paket hat an diesem Tag keinen Preis.
 */
export function paketPreisAmTag(option: Pick<DealPackageOption, "priceCents" | "catalogueSlug">, tag: DateOfferOption | null): number | null {
  if (!tag || !tagHatPreis(tag)) return option.priceCents;
  return preisAmTag(tag, option.catalogueSlug ?? null);
}

/** Preis eines Terminangebots für das gewählte Paket; null ohne Tagespreis (Termin wie vor 5b). */
export function terminPreisFuerPaket(tag: DateOfferOption, paketSlug: string | null | undefined): number | null {
  return tagHatPreis(tag) ? preisAmTag(tag, paketSlug ?? null) : null;
}

/**
 * `KvaSnapshot.totalCents` auf dem Server. Stunden-KV aus der Version: die
 * Schätzung (F10). Festpreis mit Tagespreisen aus der Version: der Preis der
 * Wahl am Anzeigetag (gleiche Funktion wie die Annahme). Ohne gewählten Tag
 * gilt derselbe Tag wie in Preiskarte und Mobil-Leiste (`anzeigeTag`:
 * empfohlen, sonst erster), F2 (Review I4): so zeigt das Portal vor der
 * Terminwahl nur einen Preis. Sonst `bisherCents`, die Regel von vor 5b.
 */
export function gesamtpreisMitWahl(input: {
  isVariable: boolean;
  bisherCents: number;
  stunden: PortalStundenAngebot | null;
  dealOptions: Array<{ id: string; priceCents: number; catalogueSlug?: string | null; isRecommended?: boolean; gebunden?: boolean }>;
  boundOptionId: string | null;
  dateOffers: DateOffersContext | null;
}): number {
  if (input.isVariable) return input.stunden ? input.stunden.summeGeschaetztCent : input.bisherCents;
  const d = input.dateOffers;
  const tag = d ? anzeigeTag(d)?.tag : undefined;
  if (!d || !tag || !tagHatPreis(tag)) return input.bisherCents;
  return erwarteterGesamtpreis({
    dealOptions: input.dealOptions,
    selectedOptionId: input.boundOptionId,
    totalCents: input.bisherCents,
    dateOffers: terminPreise(d.options),
    selectedDateOfferId: tag.id,
  });
}

// ─── Stunden-KV ─────────────────────────────────────────────────────────────

const zahl = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** `document_details.stunden` prüfen; null, wenn es kein vollständiges Stunden-Angebot aus der Version ist. */
export function stundenAngebotAus(raw: unknown): PortalStundenAngebot | null {
  if (!raw || typeof raw !== "object") return null;
  const s = raw as Record<string, unknown>;
  const felder = ["helfer", "transporter", "stundenGeschaetzt", "mindestStunden", "satzHelferEur", "satzTransporterEur", "summeGeschaetztCent", "mindestbetragCent"] as const;
  if (s.quelle !== "version" || !felder.every((f) => zahl(s[f]))) return null;
  if ((s.summeGeschaetztCent as number) <= 0) return null;
  return {
    helfer: s.helfer as number,
    transporter: s.transporter as number,
    stundenGeschaetzt: s.stundenGeschaetzt as number,
    mindestStunden: s.mindestStunden as number,
    satzHelferEur: s.satzHelferEur as number,
    satzTransporterEur: s.satzTransporterEur as number,
    summeGeschaetztCent: s.summeGeschaetztCent as number,
    mindestbetragCent: s.mindestbetragCent as number,
    quelle: "version",
  };
}

/**
 * Stundensatz eines Stunden-KV von Hand (F11): Helfer × Satz plus je
 * Transporterzeile ihr Satz, wie die Live-Uhr. Ohne solche Posten die
 * Postensumme, die das Portal bisher als „voraussichtlich“ zeigte.
 */
export function stundensatzAltCents(lineItems: readonly KvaLineItem[], totalCents: number): number {
  let cents = 0;
  for (const li of lineItems) {
    if (li.type === "helper") cents += Math.round(li.unitRate * 100) * li.quantity;
    else if (li.type === "transporter") cents += Math.round(li.unitRate * 100);
  }
  return cents > 0 ? cents : totalCents;
}

export type StundenAnzeige =
  | { modell: "version"; stunden: PortalStundenAngebot }
  | { modell: "alt"; satzCents: number }
  | null;

/** Wie ein Stunden-KV heißt. null beim Festpreis und bei Kontexten ohne `stundenModell` (Anzeige wie vor 5b). */
export function stundenAnzeige(
  kva: Pick<KvaSnapshot, "isVariable" | "lineItems" | "totalCents" | "stunden" | "stundenModell"> | null | undefined
): StundenAnzeige {
  if (!kva?.isVariable) return null;
  if (kva.stundenModell === "version" && kva.stunden) return { modell: "version", stunden: kva.stunden };
  if (kva.stundenModell === "alt") return { modell: "alt", satzCents: stundensatzAltCents(kva.lineItems, kva.totalCents) };
  return null;
}

/** „3 Stunden“, „1 Stunde“, „3,5 Stunden“. */
export function stundenZahl(n: number): string {
  const text = Number.isInteger(n) ? String(n) : String(n).replace(".", ",");
  return `${text} ${n === 1 ? "Stunde" : "Stunden"}`;
}

/** F10: „voraussichtlich X €, abgerechnet nach Aufwand, mindestens N Stunden (Y €)“. */
export function stundenVersionText(s: PortalStundenAngebot, euro: (cents: number) => string): string {
  return `voraussichtlich ${euro(s.summeGeschaetztCent)}, abgerechnet nach Aufwand, mindestens ${stundenZahl(s.mindestStunden)} (${euro(s.mindestbetragCent)})`;
}

/** F11: „Stundensatz X € je Stunde“. */
export function stundensatzText(satzCents: number, euro: (cents: number) => string): string {
  return `Stundensatz ${euro(satzCents)} je Stunde`;
}

// ─── Wahl in Worten ─────────────────────────────────────────────────────────

/**
 * „Gewählt: Komfort am Samstag, 21. November 2026: 1.890,00 €“ (Entscheidung
 * 10). Fehlt das Paket: „Gewählt: Termin am …“, fehlt der Tag: „Gewählt:
 * Komfort: …“. Ohne Paket und Tag null.
 */
export function gewaehltText(input: { paket: string | null; tag: string | null; betrag: string }): string | null {
  if (!input.paket && !input.tag) return null;
  const was = input.paket && input.tag ? `${input.paket} am ${input.tag}` : input.paket ?? `Termin am ${input.tag}`;
  return `Gewählt: ${was}: ${input.betrag}`;
}

const WOCHENTAG_KURZ = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"] as const;
const WOCHENTAG_LANG = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"] as const;
const MONAT = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"] as const;

function teile(ymd: string): { j: number; m: number; t: number; wt: number } | null {
  const r = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!r) return null;
  const [j, m, t] = [Number(r[1]), Number(r[2]), Number(r[3])];
  return { j, m, t, wt: new Date(Date.UTC(j, m - 1, t)).getUTCDay() };
}

/** „Sa 21.11.“ (Paketkarten, Preiskarte). */
export function tagKurz(ymd: string): string {
  const d = teile(ymd);
  if (!d) return ymd;
  return `${WOCHENTAG_KURZ[d.wt]} ${String(d.t).padStart(2, "0")}.${String(d.m).padStart(2, "0")}.`;
}

/** „Samstag, 21. November 2026“ (Bestätigung, Mappe, Annahmedialog). */
export function tagLang(ymd: string): string {
  const d = teile(ymd);
  if (!d) return ymd;
  return `${WOCHENTAG_LANG[d.wt]}, ${d.t}. ${MONAT[d.m - 1]} ${d.j}`;
}
