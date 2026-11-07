/**
 * KV aus einer gesperrten Kalkulationsversion: Nicht-Kottke rendert sofort
 * über den CRM-Renderer (`storeCommercialDocument`, liest die Quotation, die
 * das Sperren geschrieben hat), Kottke bleibt auf dem VPS-Weg „Dokument
 * erzeugen“ und bekommt nur einen Hinweis (Plan-Entscheidung 1). Gespeichert
 * und mit der Version verknüpft wird der KV nur, wenn die gerenderte Quotation
 * auf genau diese Version zeigt (sonst dieselbe Ablehnung wie vor dem Rendern).
 *
 * Abhängigkeiten sind über `KvAusVersionOptionen` austauschbar; die Vorgaben
 * laden DB-Lader erst beim Aufruf (Tests berühren `@/db` nie).
 */
import type { DocumentCopy } from "@openclaw-crm/document-templates";
import { angebotPasstZuVersion, type AngebotsWahl, type Plan5Schalter, type VersionsPreise } from "@/lib/angebot-wahl";
import { versionsPreiseAusZeile } from "@/lib/kalkulation-versionen";
import { ohnePreisangaben } from "@/lib/ohne-preisangaben";
import type { DealDocumentMeta } from "@/services/deal-documents";
import type { storeCommercialDocument } from "@/services/commercial-documents";
import { PAKETE_TEXT, VersionsFehler, type VersionsZeile } from "./kalkulation-versionen";

export type KvAusVersionErgebnis =
  | { renderer: "crm"; document: DealDocumentMeta; fileName: string }
  | { renderer: "vps"; hinweis: string };

type VersionFuerKv = Pick<VersionsZeile, "id" | "status"> &
  Partial<Pick<VersionsZeile, "pricingMode" | "priceCents" | "kvItems" | "packagePrices" | "dayPrices">>;

export interface KvAusVersionOptionen {
  ladeVersion?: (ws: string, deal: string, version: number) => Promise<VersionFuerKv | null>;
  /** Alle Versionen des Deals (nur gelesen, wenn die Quotation nicht auf die Version zeigt). */
  ladeVersionen?: (ws: string, deal: string) => Promise<Pick<VersionsZeile, "version" | "status">[]>;
  /** `quotations.calculation_version_id` des Deals. */
  ladeAngebotsVersionId?: (deal: string) => Promise<string | null>;
  /** Deal hat Paketoptionen: deren Preis überschreibt den Festpreis der Version. */
  hatPakete?: (deal: string) => Promise<boolean>;
  /** Betreiberfirma Kottke: CRM-Renderer gesperrt. */
  istKottke?: (ws: string, deal: string) => Promise<boolean>;
  speichereKv?: typeof storeCommercialDocument;
  /** Plan 5b: Firmen-Schalter des Deals. */
  ladeSchalter?: (ws: string, deal: string) => Promise<Plan5Schalter>;
  /**
   * Plan 5b: Festpreis und Posten der Quotation (für `angebotPasstZuVersion`) und,
   * F2 (I1), ihre aktuelle Wahl (Paket der gewählten gebundenen Option, gewählter Tag,
   * wie `kundenwahlAnwenden`); nur sie zählt als „nicht von Hand“. F2 (Review N4):
   * beides aus einem Stand, sonst lehnt eine Paketwahl des Kunden zwischen den
   * Lesungen den KV als „von Hand geändert“ ab.
   */
  ladeAngebotUndWahl?: (deal: string, version: VersionsPreise & { id: string }) => Promise<AngebotUndWahl>;
}

export interface AngebotUndWahl {
  angebot: { fixedPrice: string | null; isVariable: boolean; lineItems: { description: string | null; quantity: number; unitRate: string | number }[] } | null;
  wahl: AngebotsWahl;
}

/**
 * Quotation und aktuelle Wahl in einer lesenden Transaktion mit REPEATABLE READ
 * (wie `getQuotation({ konsistent: true })`): alle Abfragen sehen denselben Stand.
 */
export async function angebotUndWahlLesen(deal: string, version: VersionsPreise & { id: string }): Promise<AngebotUndWahl> {
  const { db } = await import("@/db");
  const { quotationLesen } = await import("./quotations");
  const { aktuelleWahl } = await import("./kundenwahl");
  return db.transaction(
    async (tx) => {
      const angebot = await quotationLesen(tx, deal);
      const wahl = await aktuelleWahl(tx, deal, version, angebot?.selectedPackageOptionId ?? null);
      return { angebot, wahl };
    },
    { isolationLevel: "repeatable read", accessMode: "read only" }
  );
}

async function abhaengigkeiten(o: KvAusVersionOptionen): Promise<Required<KvAusVersionOptionen>> {
  const speicher = async () => (await import("./kalkulation-versionen-speicher")).dbVersionsSpeicher;
  return {
    ladeVersion: o.ladeVersion ?? (async (ws, deal, v) => (await speicher()).lesen(ws, deal, v)),
    ladeVersionen: o.ladeVersionen ?? (async (ws, deal) => (await speicher()).liste(ws, deal)),
    ladeAngebotsVersionId: o.ladeAngebotsVersionId ?? (await import("./deal-documents")).angebotsVersionId,
    hatPakete: o.hatPakete ?? (await import("./rechner/pakete")).hatPaketoptionen,
    istKottke: o.istKottke ?? (await import("@/lib/kottke-crm-renderer-deal")).dealBlocksInRepoCrmRenderer,
    speichereKv: o.speichereKv ?? (await import("./commercial-documents")).storeCommercialDocument,
    ladeSchalter: o.ladeSchalter ?? (async (ws, deal) => (await import("./plan5-schalter")).plan5Schalter(ws, deal)),
    ladeAngebotUndWahl: o.ladeAngebotUndWahl ?? angebotUndWahlLesen,
  };
}

/** Einleitung, Schluss und Bemerkungen ohne Sätze mit Beträgen; leere fallen weg. */
function textOhnePreise(copy: DocumentCopy | undefined): DocumentCopy {
  const aus: DocumentCopy = {};
  for (const feld of ["intro", "closing", "remarks"] as const) {
    const text = copy?.[feld];
    if (typeof text !== "string") continue;
    const rest = ohnePreisangaben(text);
    if (rest) aus[feld] = rest;
  }
  return aus;
}

export async function kvAusVersion(
  input: { workspaceId: string; dealRecordId: string; version: number; copy?: DocumentCopy; updatedBy: string | null },
  optionen: KvAusVersionOptionen = {}
): Promise<KvAusVersionErgebnis> {
  const d = await abhaengigkeiten(optionen);
  const { workspaceId, dealRecordId, version: n } = input;

  const version = await d.ladeVersion(workspaceId, dealRecordId, n);
  if (!version) throw new VersionsFehler("NICHT_GEFUNDEN", `Version v${n} nicht gefunden.`);
  if (version.status !== "gesperrt") {
    throw new VersionsFehler("UNGUELTIG", `Version v${n} ist nicht gesperrt.`);
  }
  // Die Quotation zeigt nicht (mehr) auf diese Version.
  const ablehnen = async (): Promise<never> => {
    // Neuere gesperrte Version: auf sie verweisen, statt eine weitere Sperre nahezulegen.
    const neueste = (await d.ladeVersionen(workspaceId, dealRecordId))
      .filter((v) => v.status === "gesperrt")
      .reduce((max, v) => Math.max(max, v.version), 0);
    if (neueste > n) {
      throw new VersionsFehler("UNGUELTIG", `Version v${n} ist nicht mehr aktuell, aktuell ist v${neueste}.`);
    }
    throw new VersionsFehler("UNGUELTIG", `Das Angebot wurde nach v${n} von Hand geändert. Neue Version sperren.`);
  };
  if ((await d.ladeAngebotsVersionId(dealRecordId)) !== version.id) await ablehnen();
  const schalter = await d.ladeSchalter(workspaceId, dealRecordId);
  if (!schalter.angebotAusKalkulation) {
    // Ohne Schalter: der Paketpreis ersetzt den Festpreis der Version, ein so
    // gerenderter KV käme nicht aus dieser Version.
    if (await d.hatPakete(dealRecordId)) {
      throw new VersionsFehler("PAKETE", PAKETE_TEXT);
    }
  } else if (version.pricingMode !== "stunden") {
    // Plan 5b: Paketoptionen tragen die Preise der Version. Die Quotation muss genau eine
    // Wahl dieser Version sein (Kundenwahl tauscht Preis und Posten, das ist keine Handänderung).
    const preise = versionsPreiseAusZeile({
      pricingMode: version.pricingMode ?? "fest",
      priceCents: version.priceCents ?? null,
      kvItems: version.kvItems ?? [],
      packagePrices: version.packagePrices ?? [],
      dayPrices: version.dayPrices ?? [],
    });
    const { angebot: q, wahl } = await d.ladeAngebotUndWahl(dealRecordId, { ...preise, id: version.id });
    const fest = q && !q.isVariable && q.fixedPrice !== null ? Math.round(Number(q.fixedPrice) * 100) : null;
    const posten = (q?.lineItems ?? []).map((li) => ({ description: li.description ?? "", quantity: li.quantity, unitRate: Number(li.unitRate) }));
    if (!angebotPasstZuVersion({ fixedPriceCents: fest, posten }, preise, wahl)) await ablehnen();
  }

  if (await d.istKottke(workspaceId, dealRecordId)) {
    return {
      renderer: "vps",
      hinweis: `Kottke-KV über „Dokument erzeugen“ erstellen; die Preise kommen aus Version v${n}.`,
    };
  }

  const gespeichert = await d.speichereKv({
    workspaceId,
    dealRecordId,
    kind: "KV",
    copy: textOhnePreise(input.copy),
    notifyCustomer: false,
    updatedBy: input.updatedBy,
    // Bis zum Rendern kann eine andere Version gesperrt oder der Preis von Hand
    // geändert worden sein: gespeichert wird nur, was aus genau dieser Version kommt.
    pruefeVersion: async (gerendert) => {
      if (gerendert !== version.id) await ablehnen();
    },
  });
  return { renderer: "crm", document: gespeichert.document, fileName: gespeichert.fileName };
}
