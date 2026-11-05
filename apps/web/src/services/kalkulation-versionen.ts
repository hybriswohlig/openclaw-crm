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
  type GrundlageZeile,
  type Kostenzeile,
  type Uebersteuerung,
} from "@/lib/kalkulation-versionen";
import type { AngebotsEingabe, Quotation } from "@/services/quotations";
import { meldeKorrektur, rufeRechner, type RechnerAntwort, type RechnerErgebnis } from "@/services/rechner/client";
import { eingabeHash, rechnerAnfrageAus, type LeadDaten, type RechnerAnfrage } from "@/services/rechner/eingabe";
import type { KalkulationsZeile } from "@/services/rechner/kalkulation";
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

export type Autor = { userId: string | null; quelle: "mensch" | "agent" };

export type VersionsFehlerCode = "NICHT_GEFUNDEN" | "RECHNER_FEHLER" | "PAKETE" | "STUNDEN" | "UNGUELTIG" | "SPANNE";

const FEHLER_STATUS: Record<VersionsFehlerCode, number> = {
  NICHT_GEFUNDEN: 404,
  RECHNER_FEHLER: 409,
  PAKETE: 409,
  STUNDEN: 409,
  UNGUELTIG: 400,
  SPANNE: 409,
};

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
  /** Nur Entwürfe; eine inzwischen gesperrte Version wird nie geändert. */
  aktualisieren(id: string, patch: Partial<VersionsZeile>): Promise<VersionsZeile>;
  /** Eine Transaktion: Version sperren (nur aus dem Entwurf) und die Quotation des Deals schreiben. */
  sperrenUndAngebot(
    ws: string,
    deal: string,
    id: string,
    angebot: AngebotsEingabe,
    kvItems: KvPosten[],
    von: string | null
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
  opts: { cacheErlaubt?: boolean; paketHebel?: Record<string, HebelArt[]> } = {}
): Promise<Partial<VersionsZeile>> {
  const referenceDate = heuteBerlin(d.jetzt());
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

async function entwurfAnlegen(ws: string, deal: string, autor: Autor, d: Abh): Promise<{ version: VersionsZeile; neu: boolean }> {
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
    if (!anderer) throw err;
    return { version: anderer, neu: false };
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
 * Begründete Übersteuerung. An einer gesperrten Version landet sie im Entwurf
 * (angelegt, falls keiner). Danach Neuberechnung im Rechner und, nach der
 * Antwort, eine Kalibrierungsmeldung an den Rechner (Fehler nur geloggt).
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

  let ziel = angefragt;
  let neu = false;
  if (angefragt.status !== "entwurf") {
    const r = await entwurfAnlegen(ws, deal, autor, d);
    ziel = r.version;
    neu = r.neu;
  }

  if (geprueft.art === "zeile") {
    const keys = new Set((ziel.rechnerResult?.kosten?.posten ?? []).map((p) => p.key).filter((k): k is string => !!k));
    // Aufheben geht auch für eine Zeile, die der Rechner inzwischen nicht mehr liefert.
    const aufhebbar = geprueft.wert === null && ziel.overrides.some((u) => u.art === "zeile" && u.key === geprueft.key);
    if (!keys.has(geprueft.key) && !aufhebbar) throw new UebersteuerungFehler(`Unbekannte Kostenzeile: ${geprueft.key}`);
  }

  const lead = await leadOderFehler(ws, deal, d);
  const vorherAnfrage = ziel.rechnerRequest;
  const rechnerwert = rechnerwertFuer(geprueft.art, geprueft.key, vorherAnfrage ?? {}, ziel.rechnerResult);
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
  const overrides = [...ziel.overrides, neue];
  const berechnet = await neuBerechnen(ws, deal, lead, overrides, d, { paketHebel: await paketHebelFuer(ws, deal, d) });
  const gespeichert = await d.speicher.aktualisieren(ziel.id, { overrides, ...berechnet });

  const tarif = ziel.tariff ?? gespeichert.tariff;
  const meldung = {
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
  };
  d.nachher(async () => {
    try {
      const r = await d.melde(meldung);
      if (!r.ok) console.warn(`[kalkulation-versionen] Korrekturmeldung fehlgeschlagen: ${r.fehler}`);
    } catch (err) {
      console.warn("[kalkulation-versionen] Korrekturmeldung fehlgeschlagen", err);
    }
  });

  return { version: gespeichert, neu };
}

/**
 * Sperrt den Entwurf und schreibt die Quotation des Deals (eine Transaktion).
 * Vorher frisch prüfen: weicht die Eingabe ab, ist das Bezugsdatum nicht heute
 * oder stand ein Fehler an, wird zuerst neu gerechnet.
 */
export async function sperren(
  ws: string,
  deal: string,
  version: number,
  autor: Autor,
  body: { bestaetigtSpanne?: boolean },
  opts?: VersionsOptionen
): Promise<{ version: VersionsZeile; quotation: Quotation | null; gueltigkeitHinweis: string | null }> {
  const d = await abhaengigkeiten(opts);
  let v = await versionOderFehler(ws, deal, version, d);
  if (v.status !== "entwurf") throw new VersionsFehler("UNGUELTIG", `Version v${version} ist bereits gesperrt.`);
  if (await d.hatPakete(deal)) {
    throw new VersionsFehler(
      "PAKETE",
      "Dieser Lead hat Paketoptionen: Sperren kommt mit der Kalkulationsseite. Bis dahin den Preis über die Paketpreise pflegen."
    );
  }
  const vorhanden = await d.ladeAngebot(deal);
  if (v.pricingMode === "stunden" || vorhanden?.isVariable) {
    throw new VersionsFehler("STUNDEN", "Das Angebot ist ein Stunden-KV: bitte weiter über das Angebotsformular bearbeiten.");
  }
  await d.pruefeAnnahme(deal);

  const lead = await leadOderFehler(ws, deal, d);
  const heute = heuteBerlin(d.jetzt());
  const frisch = anfrageMitUebersteuerungen(rechnerAnfrageAus(lead), v.overrides, { referenceDate: heute });
  const veraltet =
    !v.rechnerRequest || eingabeHash(frisch) !== eingabeHash(v.rechnerRequest) || v.referenceDate !== heute || v.error !== null;
  if (veraltet) {
    v = await d.speicher.aktualisieren(v.id, await neuBerechnen(ws, deal, lead, v.overrides, d));
  }
  if (v.error !== null || !v.rechnerResult || !v.rechnerRequest) {
    throw new VersionsFehler("RECHNER_FEHLER", `Kalkulation nicht aktuell: ${v.error ?? "Noch keine Kalkulation vorhanden."}`);
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
  const { version: gesperrt } = await d.speicher.sperrenUndAngebot(ws, deal, v.id, u.eingabe, kvItems, autor.userId);
  await d.nachSperren(ws, deal, autor);
  const quotation = await d.ladeAngebot(deal);
  return { version: gesperrt, quotation, gueltigkeitHinweis: u.gueltigkeitHinweis };
}
