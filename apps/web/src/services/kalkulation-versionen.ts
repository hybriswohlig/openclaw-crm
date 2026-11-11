/**
 * Kalkulationsversionen je Deal: Entwurf holen oder anlegen, begründet
 * übersteuern (Neuberechnung im Rechner, Kalibrierungsmeldung), sperren
 * (schreibt die Quotation des Deals in derselben Transaktion).
 *
 * Das CRM rechnet nie nach: jede Änderung geht als Anfrage an den Rechner,
 * die Version speichert Anfrage und Ergebnis als Schnappschuss. Gesperrte
 * Versionen bleiben unverändert; eine Übersteuerung an einer gesperrten
 * Version landet im Entwurf (der bei Bedarf angelegt wird).
 *
 * Alle Abhängigkeiten sind über `VersionsOptionen` austauschbar; die
 * Vorgaben laden DB-Lader erst beim Aufruf (Tests berühren `@/db` nie).
 */
import { preisHashMitStunden } from "@/lib/stunden-preis-hash";
import {
  anzahlungPasst,
  kernBefund,
  PLAN5_FEHLER_TEXT,
  preisHash,
  standardWahl,
  verwaisteZeilenUebersteuerungen,
  wahlPreis,
  type AngebotsWahl,
  type KernBefund,
  type PaketpreisVersion,
  type Plan5FehlerCode,
  type Plan5Schalter,
  type PreisModus,
  type StundenAngebot,
  type TageAnbieten,
  type Tagespreis,
  type TagesRaster,
  type TagesSlot,
  type VersionsPreise,
} from "@/lib/angebot-wahl";
import { anteilAusRechnerFeld, type BuchungsAnteil, type KapazitaetTag } from "@/lib/einsatz";
import type { EinsatzPreisKontext } from "./einsatz-preis";
import { after } from "next/server";
import type { DealCalculationVersionRow } from "@/db/schema/deal-calculation-versions";
import {
  anfrageMitUebersteuerungen,
  grundlageAus,
  hauptPostenAus,
  kostenzeilenAus,
  kundenPreiseAus,
  kundenPreiseOhnePosten,
  kvDarstellungAus,
  paketpreiseAus,
  paketpreisUnterGrenzeAmTag,
  PLAN5_ARTEN,
  preisModusAus,
  pruefeUebersteuerung,
  rechnerwertFuer,
  sperrBefund,
  tagespreiseAus,
  UebersteuerungFehler,
  wirksameUebersteuerungen,
  type GrundlageZeile,
  type Kostenzeile,
  type SperrRegel,
  type TagKonfig,
  type Uebersteuerung,
  type MontageWert,
} from "@/lib/kalkulation-versionen";
import type { AngebotsEingabe, Quotation } from "@/services/quotations";
import { meldeKorrektur, rufeRechner, type RechnerAntwort, type RechnerErgebnis } from "@/services/rechner/client";
import { adressenZumSperren } from "@/lib/kalkulation-annahmen";
import { ADRESSE_CHAT_TEXT, ADRESSE_FEHLT_TEXT } from "@/lib/kalkulation-p15";
import { eingabeHash, mitEinsatzFeldern, mitPlan5Feldern, rechnerAnfrageAus, type LeadDaten, type RechnerAnfrage } from "@/services/rechner/eingabe";
import { ergebnisVeraltet, type KalkulationsZeile } from "@/services/rechner/kalkulation";
import { kvGueltigBis, type HebelArt, type KvPosten } from "@/services/rechner/kv-posten";
import { MARGE_MIN_PROZENT, preisBeiMarge } from "@/services/rechner/marge";
import { heuteBerlin } from "@/services/rechner/quelle";
import { angebotsUebernahme } from "@/services/rechner/uebernahme";
import { postenJeWahl, stundenPosten } from "@/services/rechner/wahl-posten";

export { PAKETE_TEXT, STUNDEN_TEXT } from "@/lib/kalkulation-versionen";

export interface VersionsMarge {
  vorschlagProzent: number | null;
  gruende: { text: string; punkte: number }[];
  gewaehltProzent: number | null;
}

export type Paketpreis = NonNullable<RechnerErgebnis["paketpreise"]>[number];
export type Tarif = NonNullable<RechnerErgebnis["tarif"]>;

type JsonFelder =
  | "overrides"
  | "inputs"
  | "costLines"
  | "margin"
  | "packagePrices"
  | "dayPrices"
  | "kvItems"
  | "tariff"
  | "rechnerRequest"
  | "rechnerResult";

/** Zeile aus `deal_calculation_versions` mit typisierten jsonb-Feldern. */
export type VersionsZeile = Omit<DealCalculationVersionRow, JsonFelder> & {
  /** Nur anhängen, nie umsortieren: die letzte Nennung je Art und Schlüssel gilt. */
  overrides: Uebersteuerung[];
  inputs: GrundlageZeile[];
  costLines: Kostenzeile[];
  margin: VersionsMarge | null;
  /** Ab Plan 5b mit Rundung, Marge, Übersteuerung und Posten je Paket (alte Einträge: slug, festpreis, selbstkosten). */
  packagePrices: PaketpreisVersion[];
  /** Plan 5b (Migration 0061): Tagespreise der Version, leer ohne Termin-Dialog. */
  dayPrices: Tagespreis[];
  kvItems: KvPosten[];
  tariff: Tarif | null;
  rechnerRequest: RechnerAnfrage | null;
  rechnerResult: RechnerErgebnis | null;
};

/**
 * Gerechneter Stand, aus dem das Sperren Preis und Posten gebildet hat. Die Sperre
 * schreibt ihn mit (eine parallel spät gelandete Neuberechnung kann ihn sonst
 * überschrieben haben); `error` wird dabei null.
 */
export type Schnappschuss = Pick<
  VersionsZeile,
  "referenceDate" | "rechnerRequest" | "rechnerResult" | "inputs" | "costLines" | "margin" | "packagePrices" | "tariff"
> &
  Partial<Pick<VersionsZeile, "vehicleBookingId">>;

/** Buchung, deren Anteil am Hauptdatum im Preis steckt; sonst null (alter Rechner, Tag außerhalb). */
export function buchungDesHauptdatums(anfrage: RechnerAnfrage | null | undefined, ergebnis: RechnerErgebnis | null | undefined): string | null {
  const a = anteilAusRechnerFeld(anfrage?.buchung);
  const b = ergebnis?.buchung;
  return a && b && b.hauptdatum === true && b.id === a.buchungId ? b.id : null;
}

export type Autor = { userId: string | null; quelle: "mensch" | "agent" };

export type VersionsFehlerCode =
  | "NICHT_GEFUNDEN"
  | "RECHNER_FEHLER"
  | "PAKETE"
  | "STUNDEN"
  | "UNGUELTIG"
  | "SPANNE"
  | "PREIS_GEAENDERT"
  /** Plan 15 (Bauteil 5): ohne Belade- oder Entladeadresse; Mensch nach Rückfrage, Agent nie. */
  | "ADRESSE_FEHLT"
  /** Plan 16: ein verschicktes Angebot ändert (sperrt) nur ein Mensch. */
  | "AENDERUNG_NUR_MENSCH"
  | Plan5FehlerCode;

const FEHLER_STATUS: Record<VersionsFehlerCode, number> = {
  NICHT_GEFUNDEN: 404,
  ADRESSE_FEHLT: 409,
  AENDERUNG_NUR_MENSCH: 409,
  RECHNER_FEHLER: 409,
  PAKETE: 409,
  STUNDEN: 409,
  UNGUELTIG: 400,
  SPANNE: 409,
  PREIS_GEAENDERT: 409,
  UEBERSTEUERUNG_VERWAIST: 409,
  KERN_NEGATIV: 409,
  PAKET_OHNE_PREIS: 409,
  PAKET_OHNE_HEBEL: 409,
  ANZAHLUNG_UEBER_PREIS: 409,
  STUNDEN_NUR_MENSCH: 409,
  STUNDEN_ZUSATZ_VPS: 409,
  STUNDEN_TRANSPORTER_VPS: 409,
  MODUSWECHSEL: 409,
  TAGESPREIS_NUR_MENSCH: 409,
};
export const PREIS_GEAENDERT_TEXT = "Der Preis hat sich beim Neurechnen geändert. Bitte prüfen und erneut sperren.";
/** Plan 16 (Bauteil 6): Bots schlagen Änderungen an einem verschickten Angebot nur vor. */
export const AENDERUNG_NUR_MENSCH_TEXT =
  "Das Angebot ist schon verschickt. Eine neue Version sperrt nur ein Mensch; Bots schlagen Änderungen über crm_propose_offer_change vor.";

/** Fachlicher Fehler des Versionen-Dienstes; Routen antworten mit `status` und `code`. */
export class VersionsFehler extends Error {
  readonly code: VersionsFehlerCode;
  readonly status: number;
  constructor(code: VersionsFehlerCode, message: string) {
    super(message);
    this.name = "VersionsFehler";
    this.code = code;
    this.status = FEHLER_STATUS[code];
  }
}

/** Der Speicher wirft ihn, wenn der Deal schon einen Entwurf hat (Teil-Unique-Index). */
export class EntwurfExistiertError extends Error {
  constructor(message = "Für diesen Deal gibt es schon einen Entwurf.") {
    super(message);
    this.name = "EntwurfExistiertError";
  }
}

export interface VersionsSpeicher {
  liste(ws: string, deal: string): Promise<VersionsZeile[]>;
  lesen(ws: string, deal: string, version: number): Promise<VersionsZeile | null>;
  entwurf(ws: string, deal: string): Promise<VersionsZeile | null>;
  anlegen(z: Omit<VersionsZeile, "id" | "createdAt" | "updatedAt">): Promise<VersionsZeile>;
  /**
   * Ergebnisfelder schreiben, nur an Entwürfen; eine inzwischen gesperrte Version
   * wird nie geändert. `overrides` im Patch wird ignoriert (nur über `anhaengen`).
   */
  aktualisieren(id: string, patch: Partial<VersionsZeile>): Promise<VersionsZeile>;
  /**
   * Hängt eine Übersteuerung atomar an (`overrides = overrides || neu`, nur am Entwurf)
   * und liefert die Zeile mit der dann aktuellen Liste (auch mit parallel angehängten).
   */
  anhaengen(id: string, u: Uebersteuerung): Promise<VersionsZeile>;
  /**
   * Eine Transaktion: Sperre des Angebots nehmen, Kundenannahme erneut prüfen (wirft
   * `AngebotAngenommenError`), Version sperren (nur aus dem Entwurf) und die Quotation
   * des Deals schreiben. Mit `stand` nur, wenn die Version noch genau so viele Übersteuerungen hat
   * und, mit `stand.updatedAt`, seit der Lesung unverändert ist (F2, I2: auch „Tage anbieten“ mit
   * gleicher Zahl an Anpassungen und ein spätes `aktualisieren` werden so erkannt).
   */
  sperrenUndAngebot(
    ws: string,
    deal: string,
    id: string,
    angebot: AngebotsEingabe,
    kvItems: KvPosten[],
    von: string | null,
    stand?: {
      uebersteuerungen: number;
      updatedAt?: Date;
      schnappschuss?: Schnappschuss;
      plan5?: Plan5Sperre;
      /**
       * Plan 16: eine aktive Kundenannahme in derselben Transaktion aufheben (statt abzulehnen).
       * Terminwahl, Reservierung, AB und Rechnung bleiben unberührt.
       */
      annahmeAufheben?: { userId: string | null; grund: string };
    }
  ): Promise<{ version: VersionsZeile; annahmeAufgehoben?: { id: string; totalCents: number | null } | null }>;
}

/**
 * Was das Sperren mit Firmen-Schalter zusätzlich festschreibt (Entscheidung 5):
 * alle Kundenpreise samt Posten je Wahl. In derselben Transaktion schreibt der
 * Speicher Paketoptionen (je `catalogue_slug`, IDs bleiben), Terminangebote (je
 * Datum) und die Quotation aus der Kundenwahl, sonst aus der Standardwahl.
 */
export interface Plan5Sperre {
  /** `priceCents` und `kvItems` = Standardwahl; im Stundenmodus die Schätzung und die Stunden-Posten. */
  preise: VersionsPreise;
  standard: AngebotsWahl;
  stunden: { posten: Array<KvPosten & { type: "helper" | "transporter" | "other" }>; angebot: StundenAngebot } | null;
}

/** Paketoption des Deals, wie Sperren und Ansicht sie brauchen. */
export interface PaketOption {
  id: string;
  catalogueSlug: string | null;
  isRecommended: boolean;
}

export interface VersionsOptionen {
  speicher?: VersionsSpeicher;
  ladeLead?: (ws: string, deal: string) => Promise<LeadDaten | null>;
  rechner?: (anfrage: RechnerAnfrage) => Promise<RechnerAntwort>;
  melde?: typeof meldeKorrektur;
  jetzt?: () => Date;
  /** Arbeit nach der Antwort (Vorgabe `after` aus next/server). */
  nachher?: (f: () => Promise<void>) => void;
  /** Wirft `AngebotAngenommenError`, wenn der Kunde den KV angenommen hat. */
  pruefeAnnahme?: (deal: string) => Promise<void>;
  hatPakete?: (deal: string) => Promise<boolean>;
  ladePaketHebel?: (ws: string, deal: string) => Promise<Record<string, HebelArt[]> | null>;
  ladeAngebot?: (deal: string) => Promise<Quotation | null>;
  ladeCache?: (deal: string) => Promise<KalkulationsZeile | null>;
  /** Schritte nach dem Sperren wie beim Speichern des Angebots (Status-Link, Umfang, Aufgaben, Phase). */
  nachSperren?: (ws: string, deal: string, autor: Autor) => Promise<void>;
  /** Plan 5b: Firmen-Schalter des Deals. */
  ladeSchalter?: (ws: string, deal: string) => Promise<Plan5Schalter>;
  /** Plan 5b: Paketoptionen des Deals (nach Reihenfolge). */
  ladePaketOptionen?: (deal: string) => Promise<PaketOption[]>;
  /** Plan 5b: Betriebsfirma Kottke (VPS-Renderer, F12). */
  istKottke?: (ws: string, deal: string) => Promise<boolean>;
  /** Plan 12a: feste Aufträge und Kapazität im Fenster (aus dem Plan, nur lesen). */
  ladeBelegung?: (
    ws: string,
    von: string,
    bis: string,
    ohneDeal?: string | null,
  ) => Promise<{ auftraege: { datum: string; dealId: string; name: string }[]; kapazitaet: KapazitaetTag[] }>;
  /** Plan 5b: Wunschtermine aus dem Portal (neueste Anfrage). */
  ladeWunschtermine?: (ws: string, deal: string) => Promise<string[]>;
  /** Plan 12b: Buchung für den Preis (Firmen-Schalter, Zuordnung); null = nichts zusätzlich an den Rechner. */
  ladeEinsatz?: (ws: string, deal: string) => Promise<EinsatzPreisKontext | null>;
  /** Plan 16: Ist eine gesperrte Version des Deals schon verschickt (KV-PDF oder Versandvermerk)? */
  istVerschickt?: (ws: string, deal: string) => Promise<boolean>;
  /** Plan 16: Ereignis nach dem Aufheben einer Annahme beim Sperren. */
  meldeAufhebung?: (e: { ws: string; deal: string; id: string; totalCents: number | null; grund: string; userId: string | null }) => Promise<void>;
}

type Abh = Required<VersionsOptionen>;

async function abhaengigkeiten(o: VersionsOptionen = {}): Promise<Abh> {
  return {
    speicher: o.speicher ?? (await import("./kalkulation-versionen-speicher")).dbVersionsSpeicher,
    ladeLead: o.ladeLead ?? (await import("./rechner/lead-daten")).ladeLeadDaten,
    rechner: o.rechner ?? ((a) => rufeRechner(a)),
    melde: o.melde ?? meldeKorrektur,
    jetzt: o.jetzt ?? (() => new Date()),
    nachher: o.nachher ?? ((f) => after(f)),
    pruefeAnnahme: o.pruefeAnnahme ?? (await import("./kva-annahme")).pruefeNichtAngenommen,
    hatPakete: o.hatPakete ?? (await import("./rechner/pakete")).hatPaketoptionen,
    ladePaketHebel: o.ladePaketHebel ?? (await import("./kalkulation-versionen-speicher")).ladePaketHebel,
    ladeAngebot: o.ladeAngebot ?? (await import("./quotations")).getQuotation,
    ladeCache: o.ladeCache ?? (await import("./rechner/speicher")).dbSpeicher.lesen,
    nachSperren: o.nachSperren ?? nachSperrenStandard,
    ladeSchalter: o.ladeSchalter ?? (async (ws, deal) => (await import("./plan5-schalter")).plan5Schalter(ws, deal)),
    ladePaketOptionen: o.ladePaketOptionen ?? (async (deal) => (await import("./kalkulation-versionen-speicher")).ladePaketOptionen(deal)),
    istKottke: o.istKottke ?? (async (ws, deal) => (await import("@/lib/kottke-crm-renderer-deal")).dealBlocksInRepoCrmRenderer(ws, deal)),
    ladeBelegung:
      o.ladeBelegung ??
      (async (ws, von, bis, ohneDeal) => (await import("./kalkulation-versionen-speicher")).ladeTagesBelegung(ws, von, bis, ohneDeal)),
    ladeWunschtermine: o.ladeWunschtermine ?? (async (ws, deal) => (await import("./kalkulation-versionen-speicher")).ladeWunschtermine(ws, deal)),
    // Wer die Firmen-Schalter selbst vorgibt (Tests, eigene Aufrufer), bekommt ohne eigene
    // Vorgabe auch keine Buchung im Preis: der Buchungs-Schalter hängt an derselben Firma.
    ladeEinsatz:
      o.ladeEinsatz ??
      (o.ladeSchalter
        ? async () => null
        : async (ws, deal) => (await import("./einsatz-preis")).einsatzPreisKontext(ws, deal, (await import("./plan5-schalter")).einsatzSchalter ?? null)),
    // Tests mit eigenem Speicher berühren die Datenbank nie: ohne Vorgabe gilt „nicht verschickt“.
    istVerschickt:
      o.istVerschickt ??
      (o.speicher ? async () => false : async (ws, deal) => (await import("./kalkulation-versionen-speicher")).istVerschickt(ws, deal)),
    meldeAufhebung: o.meldeAufhebung ?? (o.speicher ? async () => {} : meldeAufhebungStandard),
  };
}

/** Ereignis wie „Annahme aufheben“ im Status-Link, mit dem Grund aus dem Sperren. */
async function meldeAufhebungStandard(e: { ws: string; deal: string; id: string; totalCents: number | null; grund: string; userId: string | null }) {
  const { emitEvent } = await import("./activity-events");
  await emitEvent({
    workspaceId: e.ws,
    recordId: e.deal,
    objectSlug: "deals",
    eventType: "kva.annahme_aufgehoben",
    payload: { confirmationId: e.id, confirmedTotalCents: e.totalCents, grund: e.grund, userId: e.userId },
    actorId: e.userId,
  });
}

/** Dieselben Schritte wie `calculation/apply` nach dem Speichern des Angebots. */
async function nachSperrenStandard(ws: string, deal: string, autor: Autor): Promise<void> {
  const { ensureCustomerStatusLink } = await import("./customer-portal-data");
  const { captureScopeSnapshot } = await import("./scope-guard");
  const { completeAgentPriceTasks } = await import("./agent/agent-tasks");
  const { advanceDealToQuotedIfEarlier } = await import("./deal-attribution");
  const { QUOTED_REASONS } = await import("@/lib/deal-source");
  await ensureCustomerStatusLink({ workspaceId: ws, dealRecordId: deal, createdBy: autor.userId }).catch(() => {
    // Darf das Sperren nicht blockieren (wie beim normalen Speichern).
  });
  await captureScopeSnapshot(ws, deal, "issue");
  await completeAgentPriceTasks(ws, deal);
  await advanceDealToQuotedIfEarlier({ workspaceId: ws, dealRecordId: deal, reason: QUOTED_REASONS.calculationApply });
}

/** Summe der Posten in Cent (Menge × Einzelpreis auf ganze Cent). */
export function centSumme(posten: KvPosten[]): number {
  return posten.reduce((s, p) => s + Math.round(p.unitRate * 100) * p.quantity, 0);
}

function margeAus(ergebnis: RechnerErgebnis, liste: Uebersteuerung[]): VersionsMarge {
  const vorschlag = ergebnis.preis?.margeVorschlag ?? ergebnis.margeVorschlag ?? null;
  let gewaehlt: number | null = null;
  for (const u of liste) if (u.art === "marge") gewaehlt = typeof u.wert === "number" ? u.wert : null;
  return { vorschlagProzent: vorschlag?.prozent ?? null, gruende: vorschlag?.gruende ?? [], gewaehltProzent: gewaehlt };
}

/**
 * Womit eine Version gerechnet wird: Firmen-Schalter, Paket-Hebel und Paketoptionen.
 * Ohne Schalter wie vor 5b (Hebel aller aktiven Katalogpakete, sobald der Deal
 * Paketoptionen hat). Mit „Angebot aus Kalkulation“ nur die Hebel der Pakete,
 * die der Deal als Option anbietet: genau diese Preise sieht der Kunde.
 */
export interface RechenKontext {
  schalter: Plan5Schalter;
  hatPakete: boolean;
  /** An den Rechner (`paket_hebel`); undefined ohne Pakete. */
  paketHebel: Record<string, HebelArt[]> | undefined;
  /** Nur mit Schalter: Paketoptionen und Katalog-Hebel aller aktiven Pakete. */
  optionen: PaketOption[];
  katalogHebel: Record<string, HebelArt[]>;
  /** Plan 12b: Buchung im Preis; null ohne Schalter oder ohne Zuordnung (Anfrage dann wie vorher). */
  einsatz?: EinsatzPreisKontext | null;
}

/** Hebel an den Rechner: ohne Schalter alle Katalogpakete, mit Schalter nur die angebotenen. */
export function rechenHebel(
  schalter: Plan5Schalter,
  hatPakete: boolean,
  optionen: readonly PaketOption[],
  katalog: Record<string, HebelArt[]> | null
): Record<string, HebelArt[]> | undefined {
  if (!hatPakete || !katalog) return undefined;
  if (!schalter.angebotAusKalkulation) return katalog;
  const angeboten = new Set(optionen.map((o) => o.catalogueSlug).filter((x): x is string => !!x));
  const nur = Object.fromEntries(Object.entries(katalog).filter(([slug]) => angeboten.has(slug)));
  return Object.keys(nur).length > 0 ? nur : undefined;
}

/** Empfohlene Paketoption (sonst die erste); null ohne Optionen oder bei frei angelegter. */
export function empfohlenesPaket(optionen: readonly PaketOption[]): string | null {
  return (optionen.find((o) => o.isRecommended) ?? optionen[0])?.catalogueSlug ?? null;
}

async function kontextLaden(ws: string, deal: string, d: Abh): Promise<RechenKontext> {
  const [schalter, einsatz] = await Promise.all([d.ladeSchalter(ws, deal), d.ladeEinsatz(ws, deal)]);
  if (!schalter.angebotAusKalkulation) {
    const hatPakete = await d.hatPakete(deal);
    const katalog = hatPakete ? await d.ladePaketHebel(ws, deal) : null;
    return { schalter, hatPakete, paketHebel: rechenHebel(schalter, hatPakete, [], katalog), optionen: [], katalogHebel: katalog ?? {}, einsatz };
  }
  const optionen = await d.ladePaketOptionen(deal);
  const hatPakete = optionen.length > 0;
  const katalog = hatPakete ? await d.ladePaketHebel(ws, deal) : null;
  return { schalter, hatPakete, paketHebel: rechenHebel(schalter, hatPakete, optionen, katalog), optionen, katalogHebel: katalog ?? {}, einsatz };
}

/** Angebotene Tage eines Entwurfs als „Tage anbieten“-Eingabe (ohne Preise). */
function tageKonfigAus(tage: readonly Tagespreis[] | null | undefined): TagKonfig[] {
  return (tage ?? []).map((t) => ({ datum: t.datum, slots: t.slots ?? [], note: t.note ?? null, empfohlen: t.empfohlen === true }));
}

/** Anfrage an den Rechner: Lead, Übersteuerungen, Paket-Hebel und Plan-5b-Schalter (ohne Schalter wie vorher). */
function anfrageFuer(
  basis: RechnerAnfrage,
  liste: Uebersteuerung[],
  referenceDate: string,
  k: Pick<RechenKontext, "schalter" | "paketHebel" | "einsatz">,
  tage: readonly string[]
): RechnerAnfrage {
  const plan5 = mitPlan5Feldern(anfrageMitUebersteuerungen(basis, liste, { referenceDate, paketHebel: k.paketHebel }), {
    schalter: k.schalter,
    stunden: preisModusAus(liste) === "stunden",
    tage,
  });
  // Plan 12b: ohne Buchung im Preis Zeichen für Zeichen wie vorher.
  return mitEinsatzFeldern(plan5, k.einsatz?.anfrage);
}

/**
 * Anteil der Buchung, der in `day_prices` eingefroren wird (E6): aus der
 * gespeicherten Anfrage (`rechner_request.buchung`), mit Miete und geplanten
 * Aufträgen aus dem Kontext, wenn er dieselbe Buchung zum selben Anteil nennt.
 */
export function anteilFuerAnfrage(anfrage: RechnerAnfrage | null | undefined, einsatz?: EinsatzPreisKontext | null): BuchungsAnteil | null {
  const aus = anteilAusRechnerFeld(anfrage?.buchung);
  if (!aus) return null;
  const k = einsatz?.anfrage.buchung?.anteil;
  return k && k.buchungId === aus.buchungId && k.anteilCent === aus.anteilCent && k.inklusivKmAnteil === aus.inklusivKmAnteil && k.mehrkmSatzCent === aus.mehrkmSatzCent
    ? k
    : aus;
}

/**
 * Rechnet die Version neu und liefert die zu speichernden Felder. Rechnerfehler:
 * nur `error`, Anfrage, Ergebnis und Bezugsdatum der Version bleiben (Paar bleibt
 * stimmig; Sperren rechnet dann erneut). `cache` = Live-Kalkulation zur selben Anfrage.
 * Mit `wiederverwenden`: gleiche Anfrage und gleiches Bezugsdatum wie dort, dann ohne
 * Rechner (Anpassungen, die nicht an den Rechner gehen: Paket- und Tagespreis, Darstellung).
 */
async function neuBerechnen(
  ws: string,
  deal: string,
  lead: LeadDaten,
  liste: Uebersteuerung[],
  d: Abh,
  opts: {
    cacheErlaubt?: boolean;
    kontext: Pick<RechenKontext, "schalter" | "paketHebel" | "einsatz">;
    tage?: TagKonfig[];
    referenceDate?: string;
    wiederverwenden?: VersionsZeile;
    /** Schon gerechnet (Termin-Dialog): Anfrage und Ergebnis übernehmen. */
    gerechnet?: { anfrage: RechnerAnfrage; ergebnis: RechnerErgebnis };
  }
): Promise<Partial<VersionsZeile>> {
  const referenceDate = opts.referenceDate ?? heuteBerlin(d.jetzt());
  const k = opts.kontext;
  const tage = opts.tage ?? [];
  const anfrage = opts.gerechnet?.anfrage ?? anfrageFuer(rechnerAnfrageAus(lead), liste, referenceDate, k, tage.map((t) => t.datum));

  let ergebnis: RechnerErgebnis | null = opts.gerechnet?.ergebnis ?? null;
  const w = opts.wiederverwenden;
  if (
    !ergebnis &&
    w &&
    w.error === null &&
    w.rechnerResult &&
    w.rechnerRequest &&
    w.referenceDate === referenceDate &&
    eingabeHash(w.rechnerRequest) === eingabeHash(anfrage)
  ) {
    ergebnis = w.rechnerResult;
  }
  if (!ergebnis && opts.cacheErlaubt && liste.length === 0) {
    const c = await d.ladeCache(deal);
    if (
      c &&
      c.workspaceId === ws &&
      c.error === null &&
      c.result &&
      c.request?.heute === referenceDate &&
      eingabeHash(c.request) === eingabeHash(anfrage)
    ) {
      ergebnis = c.result;
    }
  }
  if (!ergebnis) {
    const antwort = await d.rechner(anfrage);
    if (!antwort.ok) return { error: antwort.fehler };
    ergebnis = antwort.ergebnis;
  }

  const festpreis = ergebnis.preis?.festpreis;
  const felder: Partial<VersionsZeile> = {
    referenceDate,
    rechnerRequest: anfrage,
    rechnerResult: ergebnis,
    error: null,
    inputs: grundlageAus(lead, ergebnis, liste),
    costLines: kostenzeilenAus(ergebnis, liste),
    margin: margeAus(ergebnis, liste),
    priceCents: typeof festpreis === "number" && Number.isFinite(festpreis) ? Math.round(festpreis * 100) : null,
    packagePrices: ergebnis.paketpreise ?? [],
    tariff: ergebnis.tarif ?? null,
  };
  // Plan 5b, nur mit Schalter (sonst Zeichen für Zeichen wie vorher).
  if (k.schalter.angebotAusKalkulation) {
    const modus = preisModusAus(liste);
    felder.pricingMode = modus;
    if (modus === "stunden") {
      const s = ergebnis.stunden;
      felder.priceCents = s ? Math.round(s.summeGeschaetztEur * 100) : null;
    }
  }
  Object.assign(felder, abgeleitetePreise(ergebnis, liste, tage, k.schalter, anteilFuerAnfrage(anfrage, k.einsatz)));
  return felder;
}

/**
 * Paket- und Tagespreise einer Version aus dem Rechner-Ergebnis, der Liste der
 * Anpassungen und den angebotenen Tagen. Ein Weg für Neuberechnung und Sperren
 * (F2, I2): Paket- und Tagespreis-Anpassungen gehen nicht an den Rechner, das
 * Sperren darf den gespeicherten Feldern deshalb nicht trauen. Ohne Schalter die
 * Paketpreise des Rechners wie vor 5b und keine Tage. Eine Paketpreis-Anpassung
 * wirkt an jedem Tag als Differenz zum Rechnerpreis am Basistag (I3).
 */
export function abgeleitetePreise(
  ergebnis: RechnerErgebnis,
  liste: Uebersteuerung[],
  tage: readonly TagKonfig[],
  schalter: Plan5Schalter,
  anteil: BuchungsAnteil | null = null
): Pick<VersionsZeile, "packagePrices"> & Partial<Pick<VersionsZeile, "dayPrices">> {
  const aus: Pick<VersionsZeile, "packagePrices"> & Partial<Pick<VersionsZeile, "dayPrices">> = {
    packagePrices: schalter.angebotAusKalkulation ? paketpreiseAus(ergebnis.paketpreise, liste) : ergebnis.paketpreise ?? [],
  };
  if (schalter.tagespreise) {
    aus.dayPrices = tagespreiseAus(ergebnis.tagespreise, tage, liste, schalter.angebotAusKalkulation ? ergebnis.paketpreise ?? null : null, anteil);
  }
  return aus;
}

/** „21.11.2026“ aus „2026-11-21“. */
const datumText = (t: string) => t.split("-").reverse().join(".");

/**
 * Untergrenze je Tag (F2, I3): Eine Paketpreis-Anpassung wirkt an jedem Tag als
 * Differenz und darf an keinem Tag unter den Preis bei 30 % Marge fallen. Wirft
 * mit Paket, Tag und Untergrenze; eine eigene Anpassung je Tag löst das.
 */
function pruefeUntergrenzeJeTag(tage: readonly Tagespreis[], liste: Uebersteuerung[], e: RechnerErgebnis | null, fehler: (text: string) => Error): void {
  const rundungHaupt = e?.preis?.rundungEur ?? 1;
  const treffer = paketpreisUnterGrenzeAmTag(tage, liste, (p) =>
    p.selbstkosten > 0 ? preisBeiMarge(p.selbstkosten, MARGE_MIN_PROZENT, p.rundungEur ?? rundungHaupt) : null
  );
  if (!treffer) return;
  throw fehler(
    `Der Paketpreis für ${treffer.slug} liegt am ${datumText(treffer.datum)} unter der Mindestmarge von ${MARGE_MIN_PROZENT} % (mindestens ${euro(treffer.grenze)}). Bitte für diesen Tag einen eigenen Preis setzen.`
  );
}

/** Anfrage aus Lead und Übersteuerungen weicht ab, oder das Bezugsdatum ist nicht heute. */
function anfrageVeraltet(
  v: VersionsZeile,
  basis: RechnerAnfrage,
  heute: string,
  paketHebel: Record<string, HebelArt[]> | null,
  schalter: Plan5Schalter,
  einsatz: EinsatzPreisKontext | null = null
): boolean {
  return (
    !v.rechnerRequest ||
    eingabeHash(
      anfrageFuer(basis, v.overrides, heute, { schalter, paketHebel: paketHebel ?? undefined, einsatz }, (v.dayPrices ?? []).map((t) => t.datum))
    ) !== eingabeHash(v.rechnerRequest) ||
    v.referenceDate !== heute
  );
}

const AUS: Plan5Schalter = { angebotAusKalkulation: false, tagespreise: false };

/**
 * Ist der Entwurf nicht mehr aktuell? Die aus Lead und Übersteuerungen neu gebaute
 * Anfrage (mit den Paket-Hebeln, mit denen der Entwurf gerechnet wird, den Schaltern
 * der Firma und den angebotenen Tagen) weicht ab, das Bezugsdatum ist nicht heute,
 * oder dem Ergebnis fehlt das Echo `montageJePosition` (Rechner vor Plan 4).
 * Gesperrte Versionen sind nie veraltet. Ein Rechnerfehler zählt hier nicht (steht in `error`).
 */
export function entwurfVeraltet(
  v: VersionsZeile,
  basis: RechnerAnfrage,
  heute: string,
  paketHebel: Record<string, HebelArt[]> | null,
  schalter: Plan5Schalter = AUS,
  einsatz: EinsatzPreisKontext | null = null
): boolean {
  if (v.status !== "entwurf") return false;
  return anfrageVeraltet(v, basis, heute, paketHebel, schalter, einsatz) || ergebnisVeraltet(v.rechnerResult);
}

async function leadOderFehler(ws: string, deal: string, d: Abh): Promise<LeadDaten> {
  const lead = await d.ladeLead(ws, deal);
  if (!lead) throw new VersionsFehler("NICHT_GEFUNDEN", "Deal nicht gefunden.");
  return lead;
}

async function versionOderFehler(ws: string, deal: string, version: number, d: Abh): Promise<VersionsZeile> {
  const v = await d.speicher.lesen(ws, deal, version);
  if (!v) throw new VersionsFehler("NICHT_GEFUNDEN", `Version v${version} nicht gefunden.`);
  return v;
}

async function entwurfAnlegen(
  ws: string,
  deal: string,
  autor: Autor,
  d: Abh,
  versuch = 0
): Promise<{ version: VersionsZeile; neu: boolean }> {
  const vorhanden = await d.speicher.entwurf(ws, deal);
  if (vorhanden) return { version: vorhanden, neu: false };

  const lead = await leadOderFehler(ws, deal, d);
  const liste = await d.speicher.liste(ws, deal);
  const naechste = liste.reduce((max, v) => Math.max(max, v.version), 0) + 1;
  const letzteGesperrte = liste.filter((v) => v.status === "gesperrt").sort((a, b) => b.version - a.version)[0];
  const overrides = [...(letzteGesperrte?.overrides ?? [])];
  const kontext = await kontextLaden(ws, deal, d);
  const heute = heuteBerlin(d.jetzt());
  // Plan 5b: angebotene Tage erbt der neue Entwurf (ohne vergangene); sonst fielen sie
  // beim nächsten Sperren still weg und mit ihnen die Terminwahl des Kunden.
  const tage = kontext.schalter.tagespreise ? tageKonfigAus(letzteGesperrte?.dayPrices).filter((t) => t.datum >= heute) : [];

  const berechnet = await neuBerechnen(ws, deal, lead, overrides, d, { cacheErlaubt: true, kontext, tage });
  const zeile: Omit<VersionsZeile, "id" | "createdAt" | "updatedAt"> = {
    workspaceId: ws,
    dealRecordId: deal,
    version: naechste,
    status: "entwurf",
    pricingMode: "fest",
    referenceDate: heuteBerlin(d.jetzt()),
    inputs: grundlageAus(lead, null, overrides),
    overrides,
    rechnerRequest: null,
    rechnerResult: null,
    error: null,
    costLines: [],
    margin: null,
    priceCents: null,
    packagePrices: [],
    dayPrices: [],
    kvItems: [],
    tariff: null,
    vehicleBookingId: null,
    createdBy: autor.userId,
    lockedAt: null,
    lockedBy: null,
    sentAt: null,
    sentVia: null,
    ...berechnet,
  };
  try {
    return { version: await d.speicher.anlegen(zeile), neu: true };
  } catch (err) {
    if (!(err instanceof EntwurfExistiertError)) throw err;
    // Doppelklick oder zwei Bots gleichzeitig: der andere war schneller, sein Entwurf gilt.
    const anderer = await d.speicher.entwurf(ws, deal);
    if (anderer) return { version: anderer, neu: false };
    // Der andere Entwurf ist schon gesperrt (Nummer belegt): einmal mit der nächsten Nummer.
    if (versuch === 0) return entwurfAnlegen(ws, deal, autor, d, 1);
    throw new VersionsFehler("UNGUELTIG", "Die Kalkulation wurde gerade geändert. Bitte erneut versuchen.");
  }
}

/** Entwurf des Deals; ohne Entwurf neu (Nummer max + 1, Übersteuerungen der letzten gesperrten Version). */
export async function entwurfHolenOderAnlegen(
  ws: string,
  deal: string,
  autor: Autor,
  opts?: VersionsOptionen
): Promise<{ version: VersionsZeile; neu: boolean }> {
  return entwurfAnlegen(ws, deal, autor, await abhaengigkeiten(opts));
}

function zahlOderNull(w: unknown): number | null {
  return typeof w === "number" && Number.isFinite(w) ? w : null;
}

/**
 * Version mit Anpassungen, die „In Angebot übernehmen“ an der Kalkulationskarte
 * übernehmen würde, ohne dass die Karte sie zeigt (sie zeigt die Live-Kalkulation):
 * der Entwurf, ohne Entwurf die letzte gesperrte Version (ein neuer Entwurf erbt
 * deren Übersteuerungen). Zählt nur, was wirkt (letzte Nennung je Art und Schlüssel,
 * aufgehobene nicht); die Marge stellt die Karte selbst ein. null = nichts davon.
 */
export async function kartenAbweichung(ws: string, deal: string, opts?: VersionsOptionen): Promise<{ version: number } | null> {
  const d = await abhaengigkeiten(opts);
  const entwurf = await d.speicher.entwurf(ws, deal);
  const basis =
    entwurf ??
    (await d.speicher.liste(ws, deal)).filter((v) => v.status === "gesperrt").sort((a, b) => b.version - a.version)[0] ??
    null;
  if (!basis) return null;
  return wirksameUebersteuerungen(basis.overrides ?? []).some((u) => u.art !== "marge") ? { version: basis.version } : null;
}

/** Ablehnungstext der Kalkulationskarte, wenn die Version Anpassungen außer der Marge hat. */
export function kartenAbweichungText(version: number): string {
  return `Für diesen Deal gibt es Anpassungen in Kalkulation v${version}. Bitte auf der Kalkulationsseite sperren oder die Anpassungen zurücknehmen.`;
}

/** Kalibrierungsmeldung nach der Antwort; Fehler nur geloggt. */
function meldeImHintergrund(d: Abh, meldung: Parameters<typeof meldeKorrektur>[0]): void {
  d.nachher(async () => {
    try {
      const r = await d.melde(meldung);
      if (!r.ok) console.warn(`[kalkulation-versionen] Korrekturmeldung fehlgeschlagen: ${r.fehler}`);
    } catch (err) {
      console.warn("[kalkulation-versionen] Korrekturmeldung fehlgeschlagen", err);
    }
  });
}

/** Wirksamer Wert einer Übersteuerung (letzte Nennung gilt), null ohne oder aufgehoben. */
export function wirksamerWert(liste: Uebersteuerung[], art: string, key: string): Uebersteuerung["wert"] {
  let wert: Uebersteuerung["wert"] = null;
  for (const u of liste) if (u.art === art && u.key === key) wert = u.wert;
  return wert;
}

/**
 * Begründete Übersteuerung. An einer gesperrten Version landet sie im Entwurf
 * (angelegt, falls keiner). Danach Neuberechnung im Rechner und, nach der
 * Antwort, eine Kalibrierungsmeldung an den Rechner (Fehler nur geloggt). Die
 * Marge meldet erst das Sperren, einmal mit der dann gültigen Marge (der Regler
 * speichert oft mehrere Zwischenwerte).
 */
export async function uebersteuern(
  ws: string,
  deal: string,
  version: number,
  eingabe: { art: string; key: string; wert: unknown; grund: string; fotoRef?: string | null },
  autor: Autor,
  opts?: VersionsOptionen
): Promise<{ version: VersionsZeile; neu: boolean }> {
  const d = await abhaengigkeiten(opts);
  const geprueft = pruefeUebersteuerung(eingabe);
  // Plan 16 (Review 1): nach dem Versand ändern Bots nichts mehr direkt, sie schlagen vor.
  if (autor.quelle === "agent" && (await d.istVerschickt(ws, deal))) {
    throw new VersionsFehler("AENDERUNG_NUR_MENSCH", AENDERUNG_NUR_MENSCH_TEXT);
  }
  const angefragt = await versionOderFehler(ws, deal, version, d);
  const lead = await leadOderFehler(ws, deal, d);
  const kontext = await kontextLaden(ws, deal, d);
  if (PLAN5_ARTEN.has(geprueft.art)) pruefePlan5Art(geprueft.art, kontext.schalter, autor);

  for (let versuch = 0; ; versuch++) {
    let ziel = angefragt;
    let neu = false;
    if (versuch > 0 || angefragt.status !== "entwurf") {
      const r = await entwurfAnlegen(ws, deal, autor, d);
      ziel = r.version;
      neu = r.neu;
    }

    if (geprueft.art === "zeile") {
      // Aufheben geht auch für eine Zeile, die der Rechner nicht (mehr) liefert, und ohne Ergebnis.
      const aufhebbar = geprueft.wert === null && ziel.overrides.some((u) => u.art === "zeile" && u.key === geprueft.key);
      if (!ziel.rechnerResult && !aufhebbar) {
        throw new VersionsFehler("RECHNER_FEHLER", "Die Kalkulation liegt noch nicht vor. Bitte zuerst neu rechnen.");
      }
      const keys = new Set((ziel.rechnerResult?.kosten?.posten ?? []).map((p) => p.key).filter((k): k is string => !!k));
      if (!keys.has(geprueft.key) && !aufhebbar) throw new UebersteuerungFehler(`Unbekannte Kostenzeile: ${geprueft.key}`);
    }
    if ((geprueft.art === "paketpreis" || geprueft.art === "tagespreis") && geprueft.wert !== null) {
      pruefeUntergrenze(geprueft.art, geprueft.key, geprueft.wert, ziel.rechnerResult);
    }

    const vorherAnfrage = ziel.rechnerRequest;
    const vorherErgebnis = ziel.rechnerResult;
    // Verglichen wird immer mit dem Wert des Rechners, nie mit einem früheren Inhaberwert:
    // ab der zweiten Übersteuerung derselben Art und desselben Schlüssels trägt die erste
    // ihn (`rechnerwert`); bei der Marge zuerst der Vorschlag des Rechners.
    const erste = ziel.overrides.find((u) => u.art === geprueft.art && u.key === geprueft.key);
    const rechnerwert =
      geprueft.art === "marge"
        ? vorherErgebnis?.preis?.margeVorschlag?.prozent ??
          vorherErgebnis?.margeVorschlag?.prozent ??
          (erste ? erste.rechnerwert : vorherErgebnis?.preis?.margeWirksamProzent ?? null)
        : erste
          ? erste.rechnerwert
          : rechnerwertFuer(geprueft.art, geprueft.key, vorherAnfrage ?? {}, vorherErgebnis);
    // Review I3: die Wahl je Möbel ist eine Liste unter einem Schlüssel; die letzte ersetzt die ganze
    // Liste. Mit der wirksamen Wahl im Ziel-Entwurf zusammenführen (neue gewinnt je Möbel), sonst setzte
    // eine Wahl an einer gesperrten Version still die Wahl anderer Möbel im Entwurf zurück.
    let wert = geprueft.wert;
    if (geprueft.art === "montage" && wert && typeof wert === "object" && "positionen" in wert) {
      const alt = wirksamerWert(ziel.overrides, "montage", geprueft.key);
      const altePositionen = alt && typeof alt === "object" && "positionen" in alt ? (alt as MontageWert).positionen : {};
      wert = { positionen: { ...altePositionen, ...(wert as MontageWert).positionen } };
    }
    const neue: Uebersteuerung = {
      id: crypto.randomUUID(),
      art: geprueft.art,
      key: geprueft.key,
      rechnerwert,
      wert,
      grund: geprueft.grund,
      autor: { userId: autor.userId, quelle: autor.quelle },
      zeit: d.jetzt().toISOString(),
      fotoRef: eingabe.fotoRef ?? null,
    };

    // Paketpreis: die Differenz gilt an jedem angebotenen Tag, die Untergrenze auch (I3).
    if (geprueft.art === "paketpreis" && geprueft.wert !== null && ziel.rechnerResult && kontext.schalter.tagespreise) {
      const probe = [...ziel.overrides, neue];
      const tage = abgeleitetePreise(ziel.rechnerResult, probe, tageKonfigAus(ziel.dayPrices), kontext.schalter).dayPrices ?? [];
      pruefeUntergrenzeJeTag(tage, probe, ziel.rechnerResult, (t) => new UebersteuerungFehler(t));
    }

    // Atomar anhängen; gerechnet wird mit der Liste, die der Speicher danach liefert
    // (enthält auch parallel angehängte Übersteuerungen). Schreibt ein paralleler Lauf
    // ein Ergebnis zu einer älteren Liste, erkennt das Sperren die Abweichung und rechnet neu.
    let mitNeuer: VersionsZeile;
    try {
      mitNeuer = await d.speicher.anhaengen(ziel.id, neue);
    } catch (err) {
      // Der Entwurf wurde gerade gesperrt: die Übersteuerung gehört in den nächsten Entwurf.
      if (err instanceof VersionsFehler && err.code === "UNGUELTIG" && versuch === 0) continue;
      throw err;
    }

    let gespeichert: VersionsZeile;
    try {
      const berechnet = await neuBerechnen(ws, deal, lead, mitNeuer.overrides, d, {
        kontext,
        tage: tageKonfigAus(mitNeuer.dayPrices),
        // Paket- und Tagespreis, Darstellung gehen nicht an den Rechner: gleiches Ergebnis ohne neuen Aufruf.
        ...(OHNE_RECHNER.has(geprueft.art) ? { wiederverwenden: ziel } : {}),
      });
      gespeichert = await d.speicher.aktualisieren(ziel.id, berechnet);
    } catch (err) {
      // Inzwischen gesperrt. Enthält die gesperrte Version diese Übersteuerung, hat das Sperren
      // mit genau ihrer Liste gerechnet: Es leitet Paket- und Tagespreise aus Ergebnis und
      // Liste neu ab (auch Anpassungen ohne Rechner) und sperrt nur, wenn die Zeile seit
      // seiner Lesung unverändert ist (`updated_at`). Die gesperrte Version ist das Ergebnis.
      if (!(err instanceof VersionsFehler && err.code === "UNGUELTIG")) throw err;
      const gesperrt = await d.speicher.lesen(ws, deal, ziel.version);
      if (!gesperrt || !gesperrt.overrides.some((u) => u.id === neue.id)) throw err;
      gespeichert = gesperrt;
    }

    // Zurücknehmen (wert null) heißt: Rechnerwert gilt; das ist keine Korrektur. Die Marge,
    // Paket- und Tagespreise meldet erst das Sperren; Darstellung und Preismodus nie.
    if (neue.wert !== null && neue.art !== "marge" && !PLAN5_ARTEN.has(neue.art)) {
      const tarif = ziel.tariff ?? gespeichert.tariff;
      meldeImHintergrund(d, {
        crm_deal_record_id: deal,
        crm_version: gespeichert.version,
        tarif_id: tarif?.id ?? null,
        tarif_version: tarif?.version ?? null,
        marke: tarif?.marke ?? null,
        regel: neue.art,
        zeile_key: neue.key,
        eingaben: vorherAnfrage ?? gespeichert.rechnerRequest ?? {},
        rechnerwert: zahlOderNull(rechnerwert),
        inhaberwert: zahlOderNull(neue.wert),
        grund: neue.grund,
        autor: autor.userId ?? "agent",
        foto_ref: neue.fotoRef,
      });
    }

    return { version: gespeichert, neu };
  }
}

const OHNE_RECHNER: ReadonlySet<string> = new Set(["paketpreis", "tagespreis", "kv_darstellung"]);

/** Plan 16: Arten, die eine Kundenänderung setzen darf (keine Preise, Sätze oder Zeilen). */
const AENDERUNGS_ARTEN: ReadonlySet<string> = new Set(["eingabe", "montage", "zeitposten", "material_frei"]);

/**
 * Plan 16 (Bauteil 2): mehrere Übersteuerungen einer Kundenänderung in den Entwurf
 * (angelegt, falls keiner), danach EINE Neuberechnung. Wie `uebersteuern`: geprüft,
 * atomar angehängt, Rechnerwert der ersten Nennung, Wahl je Möbel mit der wirksamen
 * zusammengeführt. Anders: jede trägt ihre Herkunft, und es gibt keine
 * Kalibrierungsmeldung (der Kunde ändert den Umfang, der Rechner lag nicht falsch).
 */
export async function aenderungenAnwenden(
  ws: string,
  deal: string,
  eingaben: Array<{ art: string; key: string; wert: unknown; grund: string; herkunft: "chat" | "eingabe" | "bot" | "foto" }>,
  autor: Autor,
  opts?: VersionsOptionen,
  /** Review 6: nur an genau diesem Entwurf; ist er inzwischen gesperrt oder ein anderer, nichts anhängen. */
  entwurfVersion?: number
): Promise<{ version: VersionsZeile; neu: boolean }> {
  const d = await abhaengigkeiten(opts);
  const geprueft = eingaben.map((e) => {
    if (!AENDERUNGS_ARTEN.has(e.art)) throw new UebersteuerungFehler(`Diese Art gehört nicht zu einer Kundenänderung: ${e.art}`);
    return { ...pruefeUebersteuerung(e), herkunft: e.herkunft };
  });
  const lead = await leadOderFehler(ws, deal, d);
  const kontext = await kontextLaden(ws, deal, d);
  const { version: ziel, neu } =
    entwurfVersion === undefined ? await entwurfAnlegen(ws, deal, autor, d) : { version: await d.speicher.entwurf(ws, deal), neu: false };
  if (!ziel || (entwurfVersion !== undefined && ziel.version !== entwurfVersion)) {
    throw new VersionsFehler("UNGUELTIG", "Der Entwurf wurde gerade gesperrt. Bitte die Änderung neu starten.");
  }
  if (geprueft.length === 0) return { version: ziel, neu };

  let stand = ziel;
  for (const g of geprueft) {
    const erste = stand.overrides.find((u) => u.art === g.art && u.key === g.key);
    const rechnerwert = erste ? erste.rechnerwert : rechnerwertFuer(g.art, g.key, stand.rechnerRequest ?? {}, stand.rechnerResult);
    let wert = g.wert;
    if (g.art === "montage" && wert && typeof wert === "object" && "positionen" in wert) {
      const alt = wirksamerWert(stand.overrides, "montage", g.key);
      const altePositionen = alt && typeof alt === "object" && "positionen" in alt ? (alt as MontageWert).positionen : {};
      wert = { positionen: { ...altePositionen, ...(wert as MontageWert).positionen } };
    }
    const neue: Uebersteuerung = {
      id: crypto.randomUUID(),
      art: g.art,
      key: g.key,
      rechnerwert,
      wert,
      grund: g.grund,
      autor: { userId: autor.userId, quelle: autor.quelle },
      zeit: d.jetzt().toISOString(),
      fotoRef: null,
      herkunft: g.herkunft,
    };
    try {
      stand = await d.speicher.anhaengen(ziel.id, neue);
    } catch (err) {
      if (err instanceof VersionsFehler && err.code === "UNGUELTIG") {
        throw new VersionsFehler("UNGUELTIG", "Der Entwurf wurde gerade gesperrt. Bitte die Änderung neu starten.");
      }
      throw err;
    }
  }
  const berechnet = await neuBerechnen(ws, deal, lead, stand.overrides, d, { kontext, tage: tageKonfigAus(stand.dayPrices) });
  return { version: await d.speicher.aktualisieren(ziel.id, berechnet), neu };
}

/**
 * Plan-5b-Anpassungen gibt es nur mit dem Firmen-Schalter; Preismodus, Tagespreis
 * und „als ein Posten“ setzt nur ein Mensch (Entscheidung 14, F13).
 */
function pruefePlan5Art(art: string, schalter: Plan5Schalter, autor: Autor): void {
  const noetig = art === "tagespreis" ? schalter.tagespreise : schalter.angebotAusKalkulation;
  if (!noetig) {
    throw new UebersteuerungFehler(
      art === "tagespreis"
        ? "Tagespreise sind für diese Firma nicht eingeschaltet."
        : "Diese Anpassung gibt es erst mit dem Firmen-Schalter „Angebot aus Kalkulation“."
    );
  }
  if (autor.quelle !== "agent") return;
  if (art === "tagespreis") throw new VersionsFehler("TAGESPREIS_NUR_MENSCH", PLAN5_FEHLER_TEXT.TAGESPREIS_NUR_MENSCH);
  if (art === "preismodus") throw new VersionsFehler("STUNDEN_NUR_MENSCH", "Den Preismodus ändert nur ein Mensch.");
  if (art === "kv_darstellung") throw new UebersteuerungFehler("„Als ein Posten zeigen“ legt nur ein Mensch fest.");
}

/** Euro als Text für Meldungen („1.290 €“). */
const euro = (eur: number) => `${new Intl.NumberFormat("de-DE", { maximumFractionDigits: 2 }).format(eur)} €`;

/**
 * Paket- oder Tagespreis-Anpassung: nie unter dem Preis bei 30 % Marge
 * (`preisBeiMarge(selbstkosten, 30, rundungEur)`, Entscheidung 4). Das Paket bzw.
 * der Tag muss in der Rechner-Antwort stehen (sonst gibt es keine Selbstkosten).
 */
function pruefeUntergrenze(art: "paketpreis" | "tagespreis", key: string, wert: Uebersteuerung["wert"], e: RechnerErgebnis | null): void {
  const betrag = wert && typeof wert === "object" && "betrag" in wert && typeof wert.betrag === "number" ? wert.betrag : null;
  if (betrag === null) return;
  const rundungHaupt = e?.preis?.rundungEur ?? 1;
  let basis: { selbstkosten: number; rundungEur: number } | null = null;
  if (art === "paketpreis") {
    const p = (e?.paketpreise ?? []).find((x) => x.slug === key);
    if (!p) throw new UebersteuerungFehler(`Unbekanntes Paket: ${key}`);
    basis = { selbstkosten: p.selbstkosten, rundungEur: p.rundungEur ?? rundungHaupt };
  } else {
    const [datum, slug] = key.split(":");
    const t = (e?.tagespreise ?? []).find((x) => x.datum === datum);
    if (!t) throw new UebersteuerungFehler(`Der ${datum} ist kein angebotener Tag.`);
    const p = slug ? t.paketpreise?.find((x) => x.slug === slug) ?? null : null;
    if (slug && !p) throw new UebersteuerungFehler(`Unbekanntes Paket am ${datum}: ${slug}`);
    basis = p ? { selbstkosten: p.selbstkosten, rundungEur: p.rundungEur ?? rundungHaupt } : { selbstkosten: t.selbstkosten, rundungEur: rundungHaupt };
  }
  if (!(basis.selbstkosten > 0)) return;
  const grenze = preisBeiMarge(basis.selbstkosten, MARGE_MIN_PROZENT, basis.rundungEur);
  if (betrag < grenze) {
    throw new UebersteuerungFehler(`Preis liegt unter der Mindestmarge von ${MARGE_MIN_PROZENT} % (mindestens ${euro(grenze)}).`);
  }
}

/**
 * Rechnet einen Entwurf neu, wenn er veraltet ist (`entwurfVeraltet`, mit den
 * Paket-Hebeln des Deals) oder einen Rechnerfehler hat; sonst bleibt er unverändert
 * (`gerechnet: false`). Gesperrte Versionen nie (UNGUELTIG).
 */
export async function entwurfNeuRechnen(
  ws: string,
  deal: string,
  version: number,
  _autor: Autor,
  opts?: VersionsOptionen
): Promise<{ version: VersionsZeile; gerechnet: boolean }> {
  const d = await abhaengigkeiten(opts);
  const v = await versionOderFehler(ws, deal, version, d);
  if (v.status !== "entwurf") throw new VersionsFehler("UNGUELTIG", "Nur ein Entwurf kann neu gerechnet werden.");
  const lead = await leadOderFehler(ws, deal, d);
  const heute = heuteBerlin(d.jetzt());
  const kontext = await kontextLaden(ws, deal, d);
  if (
    v.error === null &&
    v.rechnerResult &&
    !entwurfVeraltet(v, rechnerAnfrageAus(lead), heute, kontext.paketHebel ?? null, kontext.schalter, kontext.einsatz ?? null)
  ) {
    return { version: v, gerechnet: false };
  }
  const berechnet = await neuBerechnen(ws, deal, lead, v.overrides, d, { kontext, tage: tageKonfigAus(v.dayPrices), referenceDate: heute });
  return { version: await d.speicher.aktualisieren(v.id, berechnet), gerechnet: true };
}

/** Body von `POST …/lock` (Entscheidung 5). */
export interface SperrBody {
  bestaetigtSpanne?: boolean;
  /** Kalkulationskarte: nur mit Marge-Anpassungen; die Karte schreibt bewusst einen Festpreis. */
  nurMarge?: boolean;
  erwartetPreisCent?: number;
  /** `preisHash` der Kundenpreise, die die Seite gezeigt hat. */
  erwartetPreisHash?: string;
  /** Ein Mensch bestätigt, dass aus dem Stunden-KV ein Festpreis wird. */
  modusWechselBestaetigt?: boolean;
  /** Plan 15 (Bauteil 5): ein Mensch bestätigt „Preis ohne echte Fahrzeiten“ (Belade- oder Entladeadresse fehlt). */
  ohneAdresseBestaetigt?: boolean;
  /**
   * Plan 16 (Bauteil 4): ein Mensch (Admin, prüft die Route) bestätigt, dass die Annahme des Kunden
   * aufgehoben wird und der Kunde das neue Angebot erneut annehmen muss.
   */
  annahmeAufhebenBestaetigt?: boolean;
}

/** Wahlen, die der Kunde treffen kann (für Kern-Regel und fehlende Tagespreise). */
function kundenWahlen(p: VersionsPreise): AngebotsWahl[] {
  const pakete: (string | null)[] = p.packagePrices.length > 0 ? p.packagePrices.map((x) => x.slug) : [null];
  if (p.dayPrices.length === 0) return pakete.map((paketSlug) => ({ paketSlug, datum: null }));
  return p.dayPrices.flatMap((t) => pakete.map((paketSlug) => ({ paketSlug, datum: t.datum })));
}

/** Kalibrierungsmeldung der wirksamen Paket- und Tagespreise beim Sperren (wie die Marge). */
function meldePreisAnpassungen(d: Abh, deal: string, v: VersionsZeile, gesperrt: VersionsZeile): void {
  const tarif = gesperrt.tariff ?? v.tariff;
  for (const u of wirksameUebersteuerungen(v.overrides)) {
    if (u.art !== "paketpreis" && u.art !== "tagespreis") continue;
    const betrag = u.wert && typeof u.wert === "object" && "betrag" in u.wert ? u.wert.betrag : null;
    meldeImHintergrund(d, {
      crm_deal_record_id: deal,
      crm_version: gesperrt.version,
      tarif_id: tarif?.id ?? null,
      tarif_version: tarif?.version ?? null,
      marke: tarif?.marke ?? null,
      regel: u.art,
      zeile_key: u.key,
      eingaben: v.rechnerRequest ?? {},
      rechnerwert: zahlOderNull(rechnerwertFuer(u.art, u.key, v.rechnerRequest ?? {}, v.rechnerResult)),
      inhaberwert: zahlOderNull(betrag),
      grund: u.grund,
      autor: u.autor.userId ?? "agent",
      foto_ref: u.fotoRef,
    });
  }
}

/**
 * Sperrt den Entwurf und schreibt die Quotation des Deals (eine Transaktion).
 * Vorher frisch prüfen: weicht die aus Lead und aktuellen Übersteuerungen neu gebaute
 * Anfrage ab, ist das Bezugsdatum nicht heute oder stand ein Fehler an, wird zuerst
 * neu gerechnet. Gesperrt wird nur, wenn die Liste bis zum Sperren gleich bleibt.
 * Mit `erwartetPreisCent` (Kalkulationsseite) nur, wenn der Preis der Standardwahl
 * genau der gezeigte ist, mit `erwartetPreisHash` nur, wenn alle Kundenpreise gleich
 * geblieben sind (sonst PREIS_GEAENDERT, nichts gesperrt).
 *
 * Plan 5b (Firmen-Schalter): Paket-, Tages- und Stundenpreise aus der Version,
 * Ablehnungen nach `sperrBefund` (eine Regel mit der Kalkulationsseite). Ohne
 * Schalter wie nach 5a, bis auf die Regel „kein stiller Wechsel vom Stunden-KV zum
 * Festpreis“: ein Mensch bestätigt mit `modusWechselBestaetigt` (die Kalkulationskarte
 * mit `nurMarge` gilt als bestätigt), ein Agent nie.
 * Nach dem Sperren meldet es eine wirksame Marge-Übersteuerung einmal an den Rechner.
 */
export async function sperren(
  ws: string,
  deal: string,
  version: number,
  autor: Autor,
  body: SperrBody,
  opts?: VersionsOptionen
): Promise<{ version: VersionsZeile; quotation: Quotation | null; gueltigkeitHinweis: string | null; annahmeAufgehoben: boolean }> {
  const d = await abhaengigkeiten(opts);
  let v = await versionOderFehler(ws, deal, version, d);
  if (v.status !== "entwurf") throw new VersionsFehler("UNGUELTIG", `Version v${version} ist bereits gesperrt.`);
  const k = await kontextLaden(ws, deal, d);
  const plan5 = k.schalter.angebotAusKalkulation || k.schalter.tagespreise;
  const vorhanden = await d.ladeAngebot(deal);
  const regel = (pricingMode: PreisModus, tage: number): SperrRegel => ({
    schalter: k.schalter,
    autor: autor.quelle,
    hatPakete: k.hatPakete,
    angebotIstStunden: vorhanden?.isVariable === true,
    pricingMode,
    modusWechselBestaetigt: autor.quelle === "mensch" && (body.modusWechselBestaetigt === true || body.nurMarge === true),
    tage: k.schalter.tagespreise ? tage : 0,
  });
  const vorab = sperrBefund(regel(v.pricingMode === "stunden" ? "stunden" : "fest", v.dayPrices?.length ?? 0));
  if (vorab) throw new VersionsFehler(vorab.code, vorab.text);
  // Plan 16 (Bauteil 6): ist schon ein Angebot verschickt, sperrt nur ein Mensch die geänderte Version.
  if (autor.quelle === "agent" && (await d.istVerschickt(ws, deal))) {
    throw new VersionsFehler("AENDERUNG_NUR_MENSCH", AENDERUNG_NUR_MENSCH_TEXT);
  }
  // Plan 16 (Bauteil 4): mit Bestätigung hebt das Sperren die Annahme auf (in der Transaktion), sonst wie bisher.
  const annahmeAufheben = autor.quelle === "mensch" && body.annahmeAufhebenBestaetigt === true;
  if (!annahmeAufheben) await d.pruefeAnnahme(deal);

  const lead = await leadOderFehler(ws, deal, d);
  const heute = heuteBerlin(d.jetzt());
  const basis = rechnerAnfrageAus(lead);
  const hebel = k.paketHebel ?? null;
  // Verglichen wird immer mit der aktuellen Liste der Version (auch nach einer Neuberechnung,
  // denn parallel kann eine Übersteuerung dazugekommen sein).
  for (let versuch = 0; entwurfVeraltet(v, basis, heute, hebel, k.schalter, k.einsatz ?? null) || v.error !== null; versuch++) {
    if (versuch > 0 && v.error !== null) break; // Rechnerfehler: unten abgelehnt
    // Frisch gerechnet, nur das Echo fehlt: der Rechner kennt Montage je Position noch nicht.
    // Sein Ergebnis gilt (sonst sperrte bis zu seinem Deploy niemand mehr).
    if (versuch > 0 && !anfrageVeraltet(v, basis, heute, hebel, k.schalter, k.einsatz ?? null)) break;
    if (versuch >= 3) throw new VersionsFehler("UNGUELTIG", "Die Kalkulation wird gerade geändert. Bitte erneut sperren.");
    v = await d.speicher.aktualisieren(
      v.id,
      await neuBerechnen(ws, deal, lead, v.overrides, d, { referenceDate: heute, kontext: k, tage: tageKonfigAus(v.dayPrices) })
    );
  }
  // F2 (I2): Paket- und Tagespreise nie aus den gespeicherten Feldern übernehmen, sondern aus
  // Ergebnis und aktueller Liste neu ableiten. Anpassungen ohne Rechner (Paket-, Tagespreis)
  // ändern den Anfrage-Hash nicht; zwischen `anhaengen` und `aktualisieren` stünden sonst
  // alte Preise neben der neuen Liste. Dass die Zeile bis zum Sperren gleich bleibt, prüft
  // `sperrenUndAngebot` über `updated_at`.
  if (plan5 && v.error === null && v.rechnerResult) {
    v = { ...v, ...abgeleitetePreise(v.rechnerResult, v.overrides, tageKonfigAus(v.dayPrices), k.schalter, anteilFuerAnfrage(v.rechnerRequest, k.einsatz)) };
    if (k.schalter.tagespreise) {
      pruefeUntergrenzeJeTag(v.dayPrices ?? [], v.overrides, v.rechnerResult, (t) => new VersionsFehler("UNGUELTIG", t));
    }
  }
  if (v.error !== null || !v.rechnerResult || !v.rechnerRequest) {
    throw new VersionsFehler("RECHNER_FEHLER", `Kalkulation nicht aktuell: ${v.error ?? "Noch keine Kalkulation vorhanden."}`);
  }
  // Plan 15 (Bauteil 5): ohne Belade- oder Entladeadresse nur nach Rückfrage (Mensch); ein Agent nie.
  // Adressen aus dem Chat zählen als vorhanden. Die Kalkulationskarte (`nurMarge`) gilt als bestätigt.
  // Review I1: eine Adresse nur aus dem Chat ist unbestätigt und braucht dieselbe Rückfrage.
  const fehlt = adressenZumSperren(v.rechnerRequest, lead);
  if ((fehlt.beladen || fehlt.entladen) && (autor.quelle === "agent" || (body.ohneAdresseBestaetigt !== true && body.nurMarge !== true))) {
    throw new VersionsFehler("ADRESSE_FEHLT", fehlt.ausChat ? ADRESSE_CHAT_TEXT : ADRESSE_FEHLT_TEXT);
  }
  // Nach dem (Neu-)Rechnen: eine Zeilen-Anpassung ohne Kostenzeile wirkt nicht mehr.
  const verwaist = verwaisteZeilenUebersteuerungen(v.overrides, v.rechnerResult.kosten?.posten ?? []);
  if (verwaist.length > 0) {
    throw new VersionsFehler("UEBERSTEUERUNG_VERWAIST", PLAN5_FEHLER_TEXT.UEBERSTEUERUNG_VERWAIST);
  }
  // Kalkulationskarte: geprüft an genau der Liste, die gesperrt wird (das Sperren gelingt
  // nur, wenn sie bis dahin gleich bleibt). Eine nach der Vorprüfung der Route angehängte
  // Anpassung wird so nicht still mit übernommen.
  if (body.nurMarge === true && wirksameUebersteuerungen(v.overrides).some((u) => u.art !== "marge")) {
    throw new VersionsFehler("UNGUELTIG", kartenAbweichungText(v.version));
  }
  // Nach dem Rechnen kann sich der Preismodus geändert haben (parallel angehängt).
  const modus: PreisModus = k.schalter.angebotAusKalkulation && v.pricingMode === "stunden" ? "stunden" : "fest";
  const nachher = sperrBefund(regel(modus, v.dayPrices?.length ?? 0));
  if (nachher) throw new VersionsFehler(nachher.code, nachher.text);

  // Die Obergrenze einer Spanne ist ein Festpreis-Begriff: der Stunden-KV trägt die
  // Schätzung aus den Stunden (Entscheidung 7), eine Bestätigung der Obergrenze entfällt.
  const bestaetigtSpanne = body.bestaetigtSpanne === true || modus === "stunden";
  const jetzt = d.jetzt();
  const u = angebotsUebernahme(
    { result: v.rechnerResult, request: v.rechnerRequest },
    vorhanden ? { notes: vorhanden.notes, isVariable: vorhanden.isVariable, validUntil: vorhanden.validUntil } : null,
    { bestaetigtSpanne, uebernommenVon: autor.quelle, jetzt }
  );
  if (!u.ok) {
    const spanne = !!v.rechnerResult.schaetzung && !bestaetigtSpanne;
    throw new VersionsFehler(spanne ? "SPANNE" : "UNGUELTIG", u.fehler);
  }

  const kvItems: KvPosten[] = u.eingabe.lineItems.map((li) => ({
    description: li.description,
    quantity: li.quantity,
    unitRate: Number(li.unitRate),
  }));

  let eingabe = u.eingabe;
  let sperrKvItems = kvItems;
  let plan5Sperre: Plan5Sperre | undefined;
  if (!plan5) {
    // Die Seite hat einen Preis gezeigt; ergibt die (Neu-)Berechnung einen anderen, nichts sperren.
    if (typeof body.erwartetPreisCent === "number" && centSumme(kvItems) !== body.erwartetPreisCent) {
      throw new VersionsFehler("PREIS_GEAENDERT", PREIS_GEAENDERT_TEXT);
    }
  } else {
    const r = plan5Preise(v, k, kvItems, centSumme(kvItems), modus);
    const istKottke = modus === "stunden" ? await d.istKottke(ws, deal) : false;
    const befund = sperrBefund({
      ...regel(modus, r.preise.dayPrices.length),
      preise: {
        pakete: k.optionen.map((o) => {
          const p = o.catalogueSlug ? r.preise.packagePrices.find((x) => x.slug === o.catalogueSlug) ?? null : null;
          return {
            slug: o.catalogueSlug,
            preis: p?.festpreis ?? null,
            hebel: o.catalogueSlug ? k.katalogHebel[o.catalogueSlug] ?? null : null,
            uebersteuert: !!p?.uebersteuert,
          };
        }),
        stunden:
          modus === "stunden"
            ? {
                kalkulierbar: !!v.rechnerResult.stunden,
                hinweis: (v.rechnerResult as { stundenHinweis?: string | null }).stundenHinweis ?? null,
                zusatzposten: v.rechnerResult.stunden?.zusatzposten.length ?? 0,
                ...(v.rechnerResult.stunden ? { transporter: v.rechnerResult.stunden.transporter } : {}),
              }
            : null,
        istKottke,
        kerne: r.kerne,
        anzahlungPasst: anzahlungPasst(vorhanden?.depositRequiredCents ?? null, r.preise),
      },
    });
    if (befund) throw new VersionsFehler(befund.code, befund.text);
    if (r.ohnePreis) throw new VersionsFehler("RECHNER_FEHLER", r.ohnePreis);
    if (r.postenFalsch) {
      throw new VersionsFehler("UNGUELTIG", "Die Posten ergeben nicht den Preis einer Wahl. Bitte neu rechnen.");
    }
    if (typeof body.erwartetPreisHash === "string" && body.erwartetPreisHash !== r.hash) {
      throw new VersionsFehler("PREIS_GEAENDERT", PREIS_GEAENDERT_TEXT);
    }
    if (typeof body.erwartetPreisCent === "number" && r.preise.priceCents !== body.erwartetPreisCent) {
      throw new VersionsFehler("PREIS_GEAENDERT", PREIS_GEAENDERT_TEXT);
    }
    // „Gültig bis“ nach dem frühesten angebotenen Tag (F17).
    const fruehester = r.preise.dayPrices[0]?.datum ?? null;
    if (fruehester) {
      const frist = kvGueltigBis(heute, fruehester).datum;
      if (frist < eingabe.validUntil) {
        eingabe = { ...eingabe, validUntil: frist, documentDetails: { ...eingabe.documentDetails, validUntil: frist } };
      }
    }
    sperrKvItems = r.preise.kvItems;
    plan5Sperre = { preise: r.preise, standard: r.standard, stunden: r.stunden };
  }

  const aufhebGrund = `Angebot geändert, neue Version v${v.version}`;
  const { version: gesperrt, annahmeAufgehoben } = await d.speicher.sperrenUndAngebot(ws, deal, v.id, eingabe, sperrKvItems, autor.userId, {
    uebersteuerungen: v.overrides.length,
    updatedAt: v.updatedAt,
    schnappschuss: {
      referenceDate: v.referenceDate,
      rechnerRequest: v.rechnerRequest,
      rechnerResult: v.rechnerResult,
      inputs: v.inputs,
      costLines: v.costLines,
      margin: v.margin,
      packagePrices: v.packagePrices,
      tariff: v.tariff,
      // Plan 12b (E6): Buchung des Hauptdatums einfrieren (nur wenn der Rechner sie dort angewandt hat).
      vehicleBookingId: buchungDesHauptdatums(v.rechnerRequest, v.rechnerResult),
    },
    ...(plan5Sperre ? { plan5: plan5Sperre } : {}),
    ...(annahmeAufheben ? { annahmeAufheben: { userId: autor.userId, grund: aufhebGrund } } : {}),
  });
  if (annahmeAufgehoben) {
    await d
      .meldeAufhebung({ ws, deal, id: annahmeAufgehoben.id, totalCents: annahmeAufgehoben.totalCents, grund: aufhebGrund, userId: autor.userId })
      .catch((err) => console.warn("[kalkulation-versionen] Ereignis Annahme aufgehoben fehlgeschlagen", err));
  }
  await d.nachSperren(ws, deal, autor);

  // Marge: einmal beim Sperren, mit der Marge, die jetzt gilt (Rechnerwert = sein Vorschlag).
  const marge = wirksameUebersteuerungen(v.overrides).filter((u) => u.art === "marge").at(-1);
  if (marge && typeof marge.wert === "number") {
    const tarif = gesperrt.tariff ?? v.tariff;
    meldeImHintergrund(d, {
      crm_deal_record_id: deal,
      crm_version: gesperrt.version,
      tarif_id: tarif?.id ?? null,
      tarif_version: tarif?.version ?? null,
      marke: tarif?.marke ?? null,
      regel: "marge",
      zeile_key: "marge",
      eingaben: v.rechnerRequest,
      rechnerwert:
        v.rechnerResult.preis?.margeVorschlag?.prozent ?? v.rechnerResult.margeVorschlag?.prozent ?? zahlOderNull(marge.rechnerwert),
      inhaberwert: marge.wert,
      grund: marge.grund,
      autor: marge.autor.userId ?? "agent",
      foto_ref: marge.fotoRef,
    });
  }
  if (plan5Sperre) meldePreisAnpassungen(d, deal, v, gesperrt);

  const quotation = await d.ladeAngebot(deal);
  return { version: gesperrt, quotation, gueltigkeitHinweis: u.gueltigkeitHinweis, annahmeAufgehoben: !!annahmeAufgehoben };
}

/**
 * Kundenpreise einer gerechneten Version mit Posten je Wahl (Task P) und die
 * Befunde fürs Sperren. Rechnet keinen Preis: Paket-, Tages- und Stundenpreise
 * kommen aus dem Rechner (mit begründeten Anpassungen), die Posten verteilen sie.
 */
export function plan5Preise(
  v: Pick<VersionsZeile, "packagePrices" | "dayPrices" | "rechnerResult" | "rechnerRequest" | "overrides">,
  k: Pick<RechenKontext, "schalter" | "optionen" | "katalogHebel">,
  hauptKv: KvPosten[],
  hauptCent: number,
  modus: PreisModus
): {
  preise: VersionsPreise;
  standard: AngebotsWahl;
  hash: string;
  stunden: Plan5Sperre["stunden"];
  kerne: KernBefund[];
  ohnePreis: string | null;
  postenFalsch: boolean;
} {
  const e = v.rechnerResult!;
  const anfrage = v.rechnerRequest!;
  const empf = empfohlenesPaket(k.optionen);
  const einPosten = k.schalter.angebotAusKalkulation && kvDarstellungAus(v.overrides) === "ein_posten";

  if (modus === "stunden") {
    const stunden = e.stunden ? stundenPosten(e.stunden) : null;
    const stundenCent = e.stunden ? Math.round(e.stunden.summeGeschaetztEur * 100) : null;
    // M4: Stunden-Anteil (Sätze, Helfer, Transporter, Mindestbetrag), wie auf der Seite.
    const hash = preisHashMitStunden(
      preisHash(
        kundenPreiseOhnePosten({ schalter: k.schalter, pricingMode: "stunden", hauptCent: null, packagePrices: [], dayPrices: [], stundenCent, empfohlenesPaket: null })
      ),
      e.stunden
    );
    const preise: VersionsPreise = {
      pricingMode: "stunden",
      priceCents: stunden?.angebot.summeGeschaetztCent ?? stundenCent,
      kvItems: stunden?.posten ?? [],
      packagePrices: [],
      dayPrices: [],
    };
    return { preise, standard: { paketSlug: null, datum: null }, hash, stunden, kerne: [], ohnePreis: null, postenFalsch: false };
  }

  const packagePrices = k.schalter.angebotAusKalkulation ? v.packagePrices ?? [] : [];
  const dayPrices = k.schalter.tagespreise ? v.dayPrices ?? [] : [];
  const hauptPosten = k.schalter.angebotAusKalkulation ? hauptPostenAus(e, anfrage, hauptCent / 100, einPosten) : hauptKv;
  // Der Hash hängt nur an Preisen: vor dem Verteilen der Posten gebildet, wie auf der Seite.
  const hash = preisHash(
    kundenPreiseOhnePosten({ schalter: k.schalter, pricingMode: "fest", hauptCent, packagePrices, dayPrices, stundenCent: null, empfohlenesPaket: empf })
  );
  const paketHebel: Record<string, HebelArt[]> = {};
  for (const p of packagePrices) paketHebel[p.slug] = k.katalogHebel[p.slug] ?? [];
  const gefuellt = postenJeWahl({
    ergebnis: e,
    anfrage,
    version: { pricingMode: "fest", priceCents: hauptCent, kvItems: hauptPosten, packagePrices, dayPrices },
    paketHebel,
    einPosten,
  });
  const preise = kundenPreiseAus(
    {
      pricingMode: "fest",
      hauptCent: gefuellt.priceCents,
      hauptPosten: gefuellt.kvItems,
      packagePrices: gefuellt.packagePrices,
      dayPrices: gefuellt.dayPrices,
    },
    empf
  );
  const standard = standardWahl(preise, packagePrices.length > 0 ? empf : null);

  const kerne: KernBefund[] = [];
  let ohnePreis: string | null = null;
  let postenFalsch = false;
  // M1: Hat die Version Pakete, braucht jeder Tag Paketpreise. Sonst kostete an diesem Tag
  // jedes Paket den Tagespreis (alter Rechner, Messpunkt-Rückfall), mit allen Hebeln als Posten.
  const ohnePakete = packagePrices.length > 0 ? dayPrices.find((t) => t.paketpreise === null) : undefined;
  if (ohnePakete) {
    ohnePreis = `Für den ${datumText(ohnePakete.datum)} liefert der Rechner keine Paketpreise. Bitte den Tag entfernen oder neu rechnen.`;
  }
  for (const w of kundenWahlen(preise)) {
    const r = wahlPreis(preise, w);
    if (!r) {
      // Paket ohne Preis meldet die Regel (PAKET_OHNE_PREIS); hier nur ein Tag ohne Preis.
      if (w.datum && !ohnePreis && (w.paketSlug === null || packagePrices.some((p) => p.slug === w.paketSlug && p.festpreis !== null))) {
        ohnePreis = `Für den ${w.datum} liefert der Rechner keinen Preis. Bitte den Tag entfernen oder den Preis mit Grund setzen.`;
      }
      continue;
    }
    kerne.push(kernBefund(r.kvItems));
    if (r.kvItems.length === 0 || centSumme(r.kvItems) !== r.priceCents) postenFalsch = true;
  }
  return { preise, standard, hash, stunden: null, kerne, ohnePreis, postenFalsch };
}

// ─── Termin-Dialog: Raster und „Tage anbieten“ (Entscheidung 12, F16, F17) ────

/** Höchstens so viele Tage fragt das Raster beim Rechner an (Rechner: 42). */
export const RASTER_MAX_TAGE = 42;
/** Höchstens so viele Tage bietet „Tage anbieten“ an. */
export const ANGEBOT_MAX_TAGE = 10;

const TAG_RE = /^\d{4}-\d{2}-\d{2}$/;
const ZEIT_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function istTag(t: unknown): t is string {
  if (typeof t !== "string" || !TAG_RE.test(t)) return false;
  const [j, m, d] = t.split("-").map(Number);
  const x = new Date(Date.UTC(j, m - 1, d));
  return x.getUTCFullYear() === j && x.getUTCMonth() === m - 1 && x.getUTCDate() === d;
}

function tagPlus(t: string, n: number): string {
  const [j, m, d] = t.split("-").map(Number);
  return new Date(Date.UTC(j, m - 1, d + n)).toISOString().slice(0, 10);
}

function tageVonBis(von: string, bis: string): string[] {
  const aus: string[] = [];
  for (let t = von; t <= bis && aus.length <= RASTER_MAX_TAGE; t = tagPlus(t, 1)) aus.push(t);
  return aus;
}

/** Hinweis, wenn die Marge übersteuert ist: dann gilt sie an allen Tagen (F16). */
function margeHinweis(liste: Uebersteuerung[]): string | null {
  const m = wirksameUebersteuerungen(liste).filter((u) => u.art === "marge").at(-1);
  if (!m || typeof m.wert !== "number") return null;
  const prozent = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 1 }).format(m.wert);
  return `Die Marge ist auf ${prozent} % gesetzt und gilt an allen Tagen. Die Tage unterscheiden sich nur durch Miete und Fahrzeit.`;
}

function pruefeTagespreisSchalter(k: RechenKontext, v: Pick<VersionsZeile, "overrides" | "pricingMode">): void {
  if (!k.schalter.tagespreise) throw new VersionsFehler("UNGUELTIG", "Tagespreise sind für diese Firma nicht eingeschaltet.");
  if (k.schalter.angebotAusKalkulation && (v.pricingMode === "stunden" || preisModusAus(v.overrides) === "stunden")) {
    throw new VersionsFehler("UNGUELTIG", STUNDEN_OHNE_TAGE);
  }
}
const STUNDEN_OHNE_TAGE = "Im Stundenmodus gibt es keine Tagespreise.";

/**
 * Monatsraster des Termin-Dialogs (`POST …/versions/[v]/tage`). Speichert nichts:
 * eine Rechner-Anfrage mit allen Tagen von `von` bis `bis` (höchstens 42), je Tag
 * der Preis des empfohlenen Pakets (sonst der Hauptpreis, mit Tagespreis-Anpassung
 * der Version), die Gründe der Marge, die festen Aufträge an dem Tag (Plan, ohne
 * diesen Deal), die Kapazität (Namen, nur wenn jemand aktiv ist) und ob der Tag
 * vorbei ist. Dazu der Wunschtermin (Deal, sonst Portal).
 */
export async function tagesRaster(
  ws: string,
  deal: string,
  version: number,
  von: string,
  bis: string,
  opts?: VersionsOptionen
): Promise<TagesRaster> {
  if (!istTag(von) || !istTag(bis)) throw new VersionsFehler("UNGUELTIG", "von und bis müssen Tage im Format JJJJ-MM-TT sein.");
  if (von > bis) throw new VersionsFehler("UNGUELTIG", "von liegt nach bis.");
  const tage = tageVonBis(von, bis);
  if (tage.length > RASTER_MAX_TAGE) throw new VersionsFehler("UNGUELTIG", `Höchstens ${RASTER_MAX_TAGE} Tage je Abfrage.`);

  const d = await abhaengigkeiten(opts);
  const v = await versionOderFehler(ws, deal, version, d);
  const k = await kontextLaden(ws, deal, d);
  pruefeTagespreisSchalter(k, v);
  const lead = await leadOderFehler(ws, deal, d);
  const heute = heuteBerlin(d.jetzt());

  const anfrage = anfrageFuer(rechnerAnfrageAus(lead), v.overrides, heute, k, tage);
  const [antwort, belegung, wunsch] = await Promise.all([
    d.rechner(anfrage),
    d.ladeBelegung(ws, von, bis, deal),
    d.ladeWunschtermine(ws, deal),
  ]);
  if (!antwort.ok) throw new VersionsFehler("RECHNER_FEHLER", antwort.fehler);

  const empf = empfohlenesPaket(k.optionen);
  const preise = tagespreiseAus(
    antwort.ergebnis.tagespreise,
    tage.map((datum) => ({ datum, slots: [], note: null, empfohlen: false })),
    v.overrides,
    k.schalter.angebotAusKalkulation ? antwort.ergebnis.paketpreise ?? null : null
  );
  const kapNachTag = new Map(belegung.kapazitaet.map((tag) => [tag.tag, tag]));
  const zellen = preise.map((t) => {
    const paket = empf && t.paketpreise ? t.paketpreise.find((p) => p.slug === empf) ?? null : null;
    const eur = paket ? paket.festpreis : t.festpreis;
    const kap = kapNachTag.get(t.datum);
    const hatPerson = kap !== undefined && kap.frei.length + kap.belegt.length + kap.abwesend.length > 0;
    return {
      datum: t.datum,
      wochentag: t.wochentag,
      feiertag: t.feiertag,
      preisCent: eur === null ? null : Math.round(eur * 100),
      gruende: t.gruende,
      auftraege: belegung.auftraege.filter((a) => a.datum === t.datum && a.dealId !== deal).map((a) => ({ dealId: a.dealId, name: a.name })),
      ...(hatPerson && kap ? { kapazitaet: { text: kap.text, ton: kap.ton, frei: kap.frei.map((p) => p.name) } } : {}),
      vergangen: t.datum < heute,
    };
  });

  const ausDeal = lead.umzugsdatum && istTag(lead.umzugsdatum) ? lead.umzugsdatum : null;
  const portal = wunsch.filter(istTag);
  const datum = ausDeal ?? portal[0] ?? null;
  return {
    von,
    bis,
    zellen,
    wunschtermin: {
      datum,
      quelle: ausDeal ? "deal" : datum ? "portal" : null,
      weitere: portal.filter((t) => t !== datum),
    },
    hinweis: margeHinweis(v.overrides),
  };
}

function pruefeSlots(slots: unknown, datum: string): TagesSlot[] {
  if (!Array.isArray(slots) || slots.length > 6) throw new UebersteuerungFehler(`${datum}: höchstens 6 Zeitfenster.`);
  return slots.map((x) => {
    const s = (x ?? {}) as Record<string, unknown>;
    const label = typeof s.label === "string" ? s.label.trim() : "";
    const zeit = (z: unknown) => (z === null || z === undefined || z === "" ? null : typeof z === "string" && ZEIT_RE.test(z) ? z : undefined);
    const startTime = zeit(s.startTime);
    const endTime = zeit(s.endTime);
    if (label.length < 1 || label.length > 80 || startTime === undefined || endTime === undefined) {
      throw new UebersteuerungFehler(`${datum}: Zeitfenster braucht eine Bezeichnung (bis 80 Zeichen) und Zeiten als HH:MM.`);
    }
    return { label, startTime, endTime };
  });
}

/** Prüft „Tage anbieten“ (bis 10 Tage, nicht vorbei, höchstens eine Empfehlung, Anpassung nur mit Grund). */
export function pruefeTageAnbieten(e: unknown, heute: string): TageAnbieten {
  const roh = (e && typeof e === "object" ? e : {}) as Record<string, unknown>;
  if (!Array.isArray(roh.tage)) throw new UebersteuerungFehler("tage muss eine Liste sein.");
  if (roh.tage.length > ANGEBOT_MAX_TAGE) throw new UebersteuerungFehler(`Höchstens ${ANGEBOT_MAX_TAGE} Tage anbieten.`);
  const gesehen = new Set<string>();
  const tage = roh.tage.map((x) => {
    const t = (x ?? {}) as Record<string, unknown>;
    if (!istTag(t.datum)) throw new UebersteuerungFehler("Tag muss ein Datum JJJJ-MM-TT sein.");
    if (t.datum < heute) throw new UebersteuerungFehler(`Der ${t.datum} liegt in der Vergangenheit.`);
    if (gesehen.has(t.datum)) throw new UebersteuerungFehler(`Der ${t.datum} steht doppelt in der Liste.`);
    gesehen.add(t.datum);
    const note = t.note === null || t.note === undefined ? null : typeof t.note === "string" ? t.note.trim().slice(0, 200) || null : null;
    return { datum: t.datum, slots: pruefeSlots(t.slots ?? [], t.datum), note, empfohlen: t.empfohlen === true };
  });
  // Höchstens eine Empfehlung; ohne Empfehlung gilt der erste Tag (`standardWahl`), wie die Tage-Route.
  if (tage.filter((t) => t.empfohlen).length > 1) throw new UebersteuerungFehler("Höchstens ein Tag kann empfohlen sein.");
  const liste = Array.isArray(roh.uebersteuerungen) ? roh.uebersteuerungen : [];
  const uebersteuerungen = liste.map((x) => {
    const u = (x ?? {}) as Record<string, unknown>;
    if (!istTag(u.datum) || !gesehen.has(u.datum)) throw new UebersteuerungFehler("Preis-Anpassung nur für einen angebotenen Tag.");
    const paketSlug = u.paketSlug === null || u.paketSlug === undefined ? null : typeof u.paketSlug === "string" ? u.paketSlug : "";
    const geprueft = pruefeUebersteuerung({
      art: "tagespreis",
      key: paketSlug === null ? u.datum : `${u.datum}:${paketSlug}`,
      wert: u.betrag,
      grund: typeof u.grund === "string" ? u.grund : "",
    });
    const betrag = geprueft.wert && typeof geprueft.wert === "object" && "betrag" in geprueft.wert ? geprueft.wert.betrag! : 0;
    return { datum: u.datum, paketSlug, betrag, grund: geprueft.grund };
  });
  return { tage, uebersteuerungen };
}

/**
 * „Tage anbieten“ (`PUT …/versions/[v]/tage`, nur Menschen): setzt die angebotenen
 * Tage samt Slots, Notiz und Empfehlung im Entwurf und die Tagespreis-Anpassungen
 * (die Liste ist der ganze gewünschte Stand: fehlende werden aufgehoben). An einer
 * gesperrten Version landet alles im nächsten Entwurf (F17: neue Tage = neue
 * Version). Gerechnet wird einmal mit den neuen Tagen; scheitert der Rechner, bleibt
 * alles wie es war. Anpassungen nie unter dem Preis bei 30 % Marge.
 */
export async function tageSetzen(
  ws: string,
  deal: string,
  version: number,
  autor: Autor,
  eingabe: TageAnbieten,
  opts?: VersionsOptionen
): Promise<VersionsZeile> {
  if (autor.quelle === "agent") throw new VersionsFehler("TAGESPREIS_NUR_MENSCH", PLAN5_FEHLER_TEXT.TAGESPREIS_NUR_MENSCH);
  const d = await abhaengigkeiten(opts);
  const heute = heuteBerlin(d.jetzt());
  const geprueft = pruefeTageAnbieten(eingabe, heute);
  const angefragt = await versionOderFehler(ws, deal, version, d);
  const k = await kontextLaden(ws, deal, d);
  pruefeTagespreisSchalter(k, angefragt);
  const lead = await leadOderFehler(ws, deal, d);

  const ziel = angefragt.status === "entwurf" ? angefragt : (await entwurfAnlegen(ws, deal, autor, d)).version;
  pruefeTagespreisSchalter(k, ziel);
  const konfig: TagKonfig[] = geprueft.tage;
  const anfrage = anfrageFuer(rechnerAnfrageAus(lead), ziel.overrides, heute, k, konfig.map((t) => t.datum));
  const antwort = await d.rechner(anfrage);
  if (!antwort.ok) throw new VersionsFehler("RECHNER_FEHLER", antwort.fehler);
  for (const u of geprueft.uebersteuerungen) {
    const key = u.paketSlug === null ? u.datum : `${u.datum}:${u.paketSlug}`;
    pruefeUntergrenze("tagespreis", key, { betrag: u.betrag }, antwort.ergebnis);
  }

  // Anpassungen angleichen: neue oder geänderte anhängen, nicht mehr gewünschte aufheben.
  const wirksam = new Map(
    wirksameUebersteuerungen(ziel.overrides)
      .filter((u) => u.art === "tagespreis")
      .map((u) => [u.key, u] as const)
  );
  const soll = new Map(geprueft.uebersteuerungen.map((u) => [u.paketSlug === null ? u.datum : `${u.datum}:${u.paketSlug}`, u] as const));
  const neue: Uebersteuerung[] = [];
  const zeit = d.jetzt().toISOString();
  const anlegen = (key: string, wert: Uebersteuerung["wert"], grund: string): Uebersteuerung => ({
    id: crypto.randomUUID(),
    art: "tagespreis",
    key,
    rechnerwert:
      ziel.overrides.find((x) => x.art === "tagespreis" && x.key === key)?.rechnerwert ??
      rechnerwertFuer("tagespreis", key, anfrage, antwort.ergebnis),
    wert,
    grund,
    autor: { userId: autor.userId, quelle: autor.quelle },
    zeit,
    fotoRef: null,
  });
  for (const [key, u] of soll) {
    const alt = wirksam.get(key);
    const altBetrag = alt?.wert && typeof alt.wert === "object" && "betrag" in alt.wert ? alt.wert.betrag : null;
    if (altBetrag !== u.betrag || alt?.grund !== u.grund) neue.push(anlegen(key, { betrag: u.betrag }, u.grund));
  }
  for (const key of wirksam.keys()) if (!soll.has(key)) neue.push(anlegen(key, null, "Im Termin-Dialog entfernt"));

  // Paketpreis-Anpassungen wirken an jedem neuen Tag als Differenz; die Untergrenze gilt je Tag (I3).
  // Geprüft vor dem Anhängen, damit ein abgelehnter Stand keine Anpassung hinterlässt.
  const probe = [...ziel.overrides, ...neue];
  pruefeUntergrenzeJeTag(
    abgeleitetePreise(antwort.ergebnis, probe, konfig, k.schalter).dayPrices ?? [],
    probe,
    antwort.ergebnis,
    (t) => new UebersteuerungFehler(t)
  );

  let liste = ziel.overrides;
  for (const u of neue) {
    try {
      liste = (await d.speicher.anhaengen(ziel.id, u)).overrides;
    } catch (err) {
      if (err instanceof VersionsFehler && err.code === "UNGUELTIG") {
        throw new VersionsFehler("UNGUELTIG", "Die Kalkulation wurde gerade gesperrt. Bitte die Tage erneut anbieten.");
      }
      throw err;
    }
  }
  const berechnet = await neuBerechnen(ws, deal, lead, liste, d, {
    kontext: k,
    tage: konfig,
    referenceDate: heute,
    // Tagespreis-Anpassungen gehen nicht an den Rechner: die Antwort oben gilt.
    gerechnet: { anfrage, ergebnis: antwort.ergebnis },
  });
  return d.speicher.aktualisieren(ziel.id, berechnet);
}
