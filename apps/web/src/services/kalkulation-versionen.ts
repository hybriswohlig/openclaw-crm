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
import { after } from "next/server";
import type { DealCalculationVersionRow } from "@/db/schema/deal-calculation-versions";
import {
  anfrageMitUebersteuerungen,
  grundlageAus,
  kostenzeilenAus,
  pruefeUebersteuerung,
  rechnerwertFuer,
  UebersteuerungFehler,
  wirksameUebersteuerungen,
  type GrundlageZeile,
  type Kostenzeile,
  type Uebersteuerung,
} from "@/lib/kalkulation-versionen";
import type { AngebotsEingabe, Quotation } from "@/services/quotations";
import { meldeKorrektur, rufeRechner, type RechnerAntwort, type RechnerErgebnis } from "@/services/rechner/client";
import { eingabeHash, rechnerAnfrageAus, type LeadDaten, type RechnerAnfrage } from "@/services/rechner/eingabe";
import { ergebnisVeraltet, type KalkulationsZeile } from "@/services/rechner/kalkulation";
import type { HebelArt, KvPosten } from "@/services/rechner/kv-posten";
import { heuteBerlin } from "@/services/rechner/quelle";
import { angebotsUebernahme } from "@/services/rechner/uebernahme";

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
  packagePrices: Paketpreis[];
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
>;

export type Autor = { userId: string | null; quelle: "mensch" | "agent" };

export type VersionsFehlerCode =
  | "NICHT_GEFUNDEN"
  | "RECHNER_FEHLER"
  | "PAKETE"
  | "STUNDEN"
  | "UNGUELTIG"
  | "SPANNE"
  | "PREIS_GEAENDERT";

const FEHLER_STATUS: Record<VersionsFehlerCode, number> = {
  NICHT_GEFUNDEN: 404,
  RECHNER_FEHLER: 409,
  PAKETE: 409,
  STUNDEN: 409,
  UNGUELTIG: 400,
  SPANNE: 409,
  PREIS_GEAENDERT: 409,
};

/** Ablehnung beim Sperren mit Paketoptionen (Sperren und KV aus der Version). */
export const PAKETE_TEXT = "Sperren mit Paketpreisen kommt später. Bis dahin den Preis über die Paketpreise pflegen.";
export const PREIS_GEAENDERT_TEXT = "Der Preis hat sich beim Neurechnen geändert. Bitte prüfen und erneut sperren.";

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
   * (sonst hat jemand dazwischen übersteuert und das Ergebnis passt nicht mehr).
   */
  sperrenUndAngebot(
    ws: string,
    deal: string,
    id: string,
    angebot: AngebotsEingabe,
    kvItems: KvPosten[],
    von: string | null,
    stand?: { uebersteuerungen: number; schnappschuss?: Schnappschuss }
  ): Promise<{ version: VersionsZeile }>;
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
  };
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

async function paketHebelFuer(ws: string, deal: string, d: Abh): Promise<Record<string, HebelArt[]> | undefined> {
  if (!(await d.hatPakete(deal))) return undefined;
  return (await d.ladePaketHebel(ws, deal)) ?? undefined;
}

/**
 * Rechnet die Version neu und liefert die zu speichernden Felder. Rechnerfehler:
 * nur `error`, Anfrage, Ergebnis und Bezugsdatum der Version bleiben (Paar bleibt
 * stimmig; Sperren rechnet dann erneut). `cache` = Live-Kalkulation zur selben Anfrage.
 */
async function neuBerechnen(
  ws: string,
  deal: string,
  lead: LeadDaten,
  liste: Uebersteuerung[],
  d: Abh,
  opts: { cacheErlaubt?: boolean; paketHebel?: Record<string, HebelArt[]>; referenceDate?: string } = {}
): Promise<Partial<VersionsZeile>> {
  const referenceDate = opts.referenceDate ?? heuteBerlin(d.jetzt());
  const anfrage = anfrageMitUebersteuerungen(rechnerAnfrageAus(lead), liste, { referenceDate, paketHebel: opts.paketHebel });

  let ergebnis: RechnerErgebnis | null = null;
  if (opts.cacheErlaubt && liste.length === 0) {
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
  return {
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
}

/** Anfrage aus Lead und Übersteuerungen weicht ab, oder das Bezugsdatum ist nicht heute. */
function anfrageVeraltet(
  v: VersionsZeile,
  basis: RechnerAnfrage,
  heute: string,
  paketHebel: Record<string, HebelArt[]> | null
): boolean {
  return (
    !v.rechnerRequest ||
    eingabeHash(anfrageMitUebersteuerungen(basis, v.overrides, { referenceDate: heute, paketHebel: paketHebel ?? undefined })) !==
      eingabeHash(v.rechnerRequest) ||
    v.referenceDate !== heute
  );
}

/**
 * Ist der Entwurf nicht mehr aktuell? Die aus Lead und Übersteuerungen neu gebaute
 * Anfrage (mit den Paket-Hebeln, mit denen der Entwurf gerechnet wird) weicht ab, das
 * Bezugsdatum ist nicht heute, oder dem Ergebnis fehlt das Echo `montageJePosition`
 * (Rechner vor Plan 4). Gesperrte Versionen sind nie veraltet. Ein Rechnerfehler
 * zählt hier nicht (steht in `error`).
 */
export function entwurfVeraltet(
  v: VersionsZeile,
  basis: RechnerAnfrage,
  heute: string,
  paketHebel: Record<string, HebelArt[]> | null
): boolean {
  if (v.status !== "entwurf") return false;
  return anfrageVeraltet(v, basis, heute, paketHebel) || ergebnisVeraltet(v.rechnerResult);
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

  const berechnet = await neuBerechnen(ws, deal, lead, overrides, d, {
    cacheErlaubt: true,
    paketHebel: await paketHebelFuer(ws, deal, d),
  });
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
  const angefragt = await versionOderFehler(ws, deal, version, d);
  const lead = await leadOderFehler(ws, deal, d);

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
    const neue: Uebersteuerung = {
      id: crypto.randomUUID(),
      art: geprueft.art,
      key: geprueft.key,
      rechnerwert,
      wert: geprueft.wert,
      grund: geprueft.grund,
      autor: { userId: autor.userId, quelle: autor.quelle },
      zeit: d.jetzt().toISOString(),
      fotoRef: eingabe.fotoRef ?? null,
    };

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
      const berechnet = await neuBerechnen(ws, deal, lead, mitNeuer.overrides, d, { paketHebel: await paketHebelFuer(ws, deal, d) });
      gespeichert = await d.speicher.aktualisieren(ziel.id, berechnet);
    } catch (err) {
      // Inzwischen gesperrt: das Sperren hat mit der aktuellen Liste (samt dieser Übersteuerung)
      // gerechnet, die gesperrte Version ist das Ergebnis.
      if (!(err instanceof VersionsFehler && err.code === "UNGUELTIG")) throw err;
      const gesperrt = await d.speicher.lesen(ws, deal, ziel.version);
      if (!gesperrt || !gesperrt.overrides.some((u) => u.id === neue.id)) throw err;
      gespeichert = gesperrt;
    }

    // Zurücknehmen (wert null) heißt: Rechnerwert gilt; das ist keine Korrektur.
    if (neue.wert !== null && neue.art !== "marge") {
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
  const paketHebel = await paketHebelFuer(ws, deal, d);
  if (v.error === null && v.rechnerResult && !entwurfVeraltet(v, rechnerAnfrageAus(lead), heute, paketHebel ?? null)) {
    return { version: v, gerechnet: false };
  }
  const berechnet = await neuBerechnen(ws, deal, lead, v.overrides, d, { paketHebel, referenceDate: heute });
  return { version: await d.speicher.aktualisieren(v.id, berechnet), gerechnet: true };
}

/**
 * Sperrt den Entwurf und schreibt die Quotation des Deals (eine Transaktion).
 * Vorher frisch prüfen: weicht die aus Lead und aktuellen Übersteuerungen neu gebaute
 * Anfrage ab, ist das Bezugsdatum nicht heute oder stand ein Fehler an, wird zuerst
 * neu gerechnet. Gesperrt wird nur, wenn die Liste bis zum Sperren gleich bleibt.
 * Mit `erwartetPreisCent` (Kalkulationsseite) nur, wenn die Posten genau den Preis
 * ergeben, den die Seite gezeigt hat (sonst PREIS_GEAENDERT, nichts gesperrt).
 * Nach dem Sperren meldet es eine wirksame Marge-Übersteuerung einmal an den Rechner.
 */
export async function sperren(
  ws: string,
  deal: string,
  version: number,
  autor: Autor,
  body: { bestaetigtSpanne?: boolean; nurMarge?: boolean; erwartetPreisCent?: number },
  opts?: VersionsOptionen
): Promise<{ version: VersionsZeile; quotation: Quotation | null; gueltigkeitHinweis: string | null }> {
  const d = await abhaengigkeiten(opts);
  let v = await versionOderFehler(ws, deal, version, d);
  if (v.status !== "entwurf") throw new VersionsFehler("UNGUELTIG", `Version v${version} ist bereits gesperrt.`);
  if (await d.hatPakete(deal)) {
    throw new VersionsFehler("PAKETE", PAKETE_TEXT);
  }
  const vorhanden = await d.ladeAngebot(deal);
  // Ein Mensch darf einen Stunden-KV bewusst auf Festpreis umstellen (wie bisher an der
  // Kalkulationskarte); ein Agent nie still. Eine Stunden-Version sperrt niemand.
  if (v.pricingMode === "stunden" || (vorhanden?.isVariable && autor.quelle === "agent")) {
    throw new VersionsFehler("STUNDEN", "Das Angebot ist ein Stunden-KV: bitte weiter über das Angebotsformular bearbeiten.");
  }
  await d.pruefeAnnahme(deal);

  const lead = await leadOderFehler(ws, deal, d);
  const heute = heuteBerlin(d.jetzt());
  const basis = rechnerAnfrageAus(lead);
  // Verglichen wird immer mit der aktuellen Liste der Version (auch nach einer Neuberechnung,
  // denn parallel kann eine Übersteuerung dazugekommen sein). Paket-Deals sind oben abgelehnt.
  for (let versuch = 0; entwurfVeraltet(v, basis, heute, null) || v.error !== null; versuch++) {
    if (versuch > 0 && v.error !== null) break; // Rechnerfehler: unten abgelehnt
    // Frisch gerechnet, nur das Echo fehlt: der Rechner kennt Montage je Position noch nicht.
    // Sein Ergebnis gilt (sonst sperrte bis zu seinem Deploy niemand mehr).
    if (versuch > 0 && !anfrageVeraltet(v, basis, heute, null)) break;
    if (versuch >= 3) throw new VersionsFehler("UNGUELTIG", "Die Kalkulation wird gerade geändert. Bitte erneut sperren.");
    v = await d.speicher.aktualisieren(v.id, await neuBerechnen(ws, deal, lead, v.overrides, d, { referenceDate: heute }));
  }
  if (v.error !== null || !v.rechnerResult || !v.rechnerRequest) {
    throw new VersionsFehler("RECHNER_FEHLER", `Kalkulation nicht aktuell: ${v.error ?? "Noch keine Kalkulation vorhanden."}`);
  }
  // Kalkulationskarte: geprüft an genau der Liste, die gesperrt wird (das Sperren gelingt
  // nur, wenn sie bis dahin gleich bleibt). Eine nach der Vorprüfung der Route angehängte
  // Anpassung wird so nicht still mit übernommen.
  if (body.nurMarge === true && wirksameUebersteuerungen(v.overrides).some((u) => u.art !== "marge")) {
    throw new VersionsFehler("UNGUELTIG", kartenAbweichungText(v.version));
  }

  const bestaetigtSpanne = body.bestaetigtSpanne === true;
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
  // Die Seite hat einen Preis gezeigt; ergibt die (Neu-)Berechnung einen anderen, nichts sperren.
  if (typeof body.erwartetPreisCent === "number" && centSumme(kvItems) !== body.erwartetPreisCent) {
    throw new VersionsFehler("PREIS_GEAENDERT", PREIS_GEAENDERT_TEXT);
  }
  const { version: gesperrt } = await d.speicher.sperrenUndAngebot(ws, deal, v.id, u.eingabe, kvItems, autor.userId, {
    uebersteuerungen: v.overrides.length,
    schnappschuss: {
      referenceDate: v.referenceDate,
      rechnerRequest: v.rechnerRequest,
      rechnerResult: v.rechnerResult,
      inputs: v.inputs,
      costLines: v.costLines,
      margin: v.margin,
      packagePrices: v.packagePrices,
      tariff: v.tariff,
    },
  });
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

  const quotation = await d.ladeAngebot(deal);
  return { version: gesperrt, quotation, gueltigkeitHinweis: u.gueltigkeitHinweis };
}
