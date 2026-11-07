/**
 * Kundenwahl aus der gesperrten Version (Plan 5b, Entscheidung 8).
 *
 * Hat die Quotation eine Version mit Paket- oder Tagespreisen, tauscht eine
 * Wahl (Paket, Tag) unter der Sperre `angebotSperren` nur `fixed_price` und
 * die Posten gegen `wahlPreis(version, { paketSlug, datum })`. Die Wahl
 * erzeugt nie eine Version, `calculation_version_id` bleibt stehen.
 *
 * Eine Paketoption oder ein Terminangebot zählt nur, wenn die Zeile an genau
 * diese Version gebunden ist (`calculation_version_id`, beim Sperren gesetzt).
 * Von Hand angelegte Zeilen behalten das alte Verhalten (Preis der Option,
 * Termin ohne Preis). So ändert sich ohne Firmen-Schalter nichts: ohne
 * Schalter schreibt das Sperren keine gebundenen Zeilen.
 *
 * Alle Funktionen lesen und schreiben nur über den Executor des Aufrufers
 * (Regel 5a: unter der Sperre nie über die globale `db`).
 */
import { and, eq } from "drizzle-orm";
import { dealCalculationVersions } from "@/db/schema/deal-calculation-versions";
import { customerDateSelections, quotationDateOffers, quotationPackageOptions } from "@/db/schema/customer-portal";
import { quotationLineItems, quotations } from "@/db/schema/quotations";
import {
  standardWahl,
  wahlPreis,
  type PaketpreisVersion,
  type Tagespreis,
  type VersionsPreise,
} from "@/lib/angebot-wahl";
import type { KvPosten } from "@/services/rechner/kv-posten";
import { pickDefaultDealOption } from "@openclaw-crm/customer-portal-core";
import type { DbExecutor } from "./kva-annahme";

export type WahlVersion = VersionsPreise & { id: string };

export interface WahlKontext {
  quotation: {
    id: string;
    calculationVersionId: string | null;
    selectedPackageOptionId: string | null;
    selectedPackageSlug: string | null;
    fixedPrice: string | null;
    isVariable: boolean;
  } | null;
  /** Nur gesetzt, wenn die Version der Quotation Paket- oder Tagespreise trägt (Festpreis). */
  version: WahlVersion | null;
}

/** Quotation des Deals und, falls vorhanden, ihre Version mit Paket- oder Tagespreisen. */
export async function ladeWahlKontext(ex: DbExecutor, dealRecordId: string): Promise<WahlKontext> {
  const [q] = await ex
    .select({
      id: quotations.id,
      calculationVersionId: quotations.calculationVersionId,
      selectedPackageOptionId: quotations.selectedPackageOptionId,
      selectedPackageSlug: quotations.selectedPackageSlug,
      fixedPrice: quotations.fixedPrice,
      isVariable: quotations.isVariable,
    })
    .from(quotations)
    .where(eq(quotations.dealRecordId, dealRecordId))
    .limit(1);
  if (!q?.calculationVersionId) return { quotation: q ?? null, version: null };

  const [v] = await ex
    .select({
      id: dealCalculationVersions.id,
      pricingMode: dealCalculationVersions.pricingMode,
      priceCents: dealCalculationVersions.priceCents,
      kvItems: dealCalculationVersions.kvItems,
      packagePrices: dealCalculationVersions.packagePrices,
      dayPrices: dealCalculationVersions.dayPrices,
    })
    .from(dealCalculationVersions)
    .where(and(eq(dealCalculationVersions.id, q.calculationVersionId), eq(dealCalculationVersions.dealRecordId, dealRecordId)))
    .limit(1);
  if (!v || v.pricingMode !== "fest") return { quotation: q, version: null };
  const packagePrices = (Array.isArray(v.packagePrices) ? v.packagePrices : []) as PaketpreisVersion[];
  const dayPrices = (Array.isArray(v.dayPrices) ? v.dayPrices : []) as Tagespreis[];
  if (packagePrices.length === 0 && dayPrices.length === 0) return { quotation: q, version: null };
  return {
    quotation: q,
    version: {
      id: v.id,
      pricingMode: "fest",
      priceCents: v.priceCents,
      kvItems: (Array.isArray(v.kvItems) ? v.kvItems : []) as KvPosten[],
      packagePrices,
      dayPrices,
    },
  };
}

type OptionZeile = { id: string; catalogueSlug: string | null; isRecommended: boolean; calculationVersionId: string | null };

/** Paketoptionen des Deals, die an die Version gebunden sind (Reihenfolge wie im Portal). */
async function gebundeneOptionen(ex: DbExecutor, dealRecordId: string, versionId: string): Promise<OptionZeile[]> {
  const rows = await ex
    .select({
      id: quotationPackageOptions.id,
      catalogueSlug: quotationPackageOptions.catalogueSlug,
      isRecommended: quotationPackageOptions.isRecommended,
      calculationVersionId: quotationPackageOptions.calculationVersionId,
    })
    .from(quotationPackageOptions)
    .where(eq(quotationPackageOptions.dealRecordId, dealRecordId))
    .orderBy(quotationPackageOptions.sortOrder);
  return rows.filter((r) => r.calculationVersionId === versionId);
}

/**
 * Paket der Wahl: die gewählte (sonst empfohlene, sonst erste) an die Version
 * gebundene Option mit Katalog-Slug. null ohne Paketpreise oder ohne gebundene Option.
 */
export async function wahlPaket(
  ex: DbExecutor,
  dealRecordId: string,
  version: WahlVersion,
  selectedOptionId: string | null
): Promise<string | null> {
  if (version.packagePrices.length === 0) return null;
  const optionen = await gebundeneOptionen(ex, dealRecordId, version.id);
  return pickDefaultDealOption(optionen, selectedOptionId)?.catalogueSlug ?? null;
}

/**
 * Tag der Wahl: der Tag der Kundenwahl, wenn ihr Terminangebot an die Version
 * gebunden ist und die Version den Tag trägt; sonst der Standardtag
 * (empfohlen, sonst erster). null ohne Tagespreise.
 */
export async function wahlDatum(ex: DbExecutor, dealRecordId: string, version: WahlVersion): Promise<string | null> {
  if (version.dayPrices.length === 0) return null;
  const [sel] = await ex
    .select({ datum: customerDateSelections.selectedDate, versionId: quotationDateOffers.calculationVersionId })
    .from(customerDateSelections)
    .innerJoin(quotationDateOffers, eq(quotationDateOffers.id, customerDateSelections.dateOfferId))
    .where(eq(customerDateSelections.dealRecordId, dealRecordId))
    .limit(1);
  if (sel && sel.versionId === version.id && version.dayPrices.some((t) => t.datum === sel.datum)) return sel.datum;
  return standardWahl(version, null).datum;
}

/** Euro-Text wie `quotations.fixed_price` aus Cent. */
export function euroText(cent: number): string {
  return (cent / 100).toFixed(2);
}

/**
 * Schreibt Festpreis und Posten der Wahl an die Quotation (nur unter der Sperre
 * des Aufrufers). `calculation_version_id`, Notizen, Anzahlung und KV-Angaben bleiben.
 */
export async function wahlSchreiben(
  tx: DbExecutor,
  quotationId: string,
  preis: { priceCents: number; kvItems: KvPosten[] },
  patch: { selectedPackageOptionId?: string | null; selectedPackageSlug?: string | null } = {}
): Promise<void> {
  const posten = preis.kvItems.map((p, i) => {
    if (!Number.isInteger(p.quantity)) throw new Error(`Posten ${i + 1}: Menge muss ganzzahlig sein.`);
    if (!Number.isFinite(p.unitRate)) throw new Error(`Posten ${i + 1}: Einzelpreis ist keine Zahl.`);
    return { description: p.description, quantity: p.quantity, unitRate: p.unitRate.toFixed(2), sortOrder: i };
  });
  await tx
    .update(quotations)
    .set({ ...patch, fixedPrice: euroText(preis.priceCents), isVariable: false, updatedAt: new Date() })
    .where(eq(quotations.id, quotationId));
  await tx.delete(quotationLineItems).where(eq(quotationLineItems.quotationId, quotationId));
  if (posten.length > 0) {
    await tx.insert(quotationLineItems).values(posten.map((p) => ({ quotationId, type: "other" as const, ...p })));
  }
}

/**
 * Wendet die aktuelle Kundenwahl (gewählte Option, gewählter Tag, sonst
 * Standard) erneut auf die Quotation an. Für das Sperren (Task K): nach dem
 * Schreiben von Optionen und Terminangeboten in derselben Transaktion
 * aufrufen, damit eine erhaltene Kundenwahl auch ihren Preis behält.
 * Liefert "ohne_version" (nichts geschrieben), "ohne_preis" (Wahl ohne Preis,
 * nichts geschrieben) oder "geschrieben".
 */
export async function kundenwahlAnwenden(
  tx: DbExecutor,
  dealRecordId: string
): Promise<"ohne_version" | "ohne_preis" | "geschrieben"> {
  const k = await ladeWahlKontext(tx, dealRecordId);
  if (!k.quotation || !k.version) return "ohne_version";
  const paketSlug = await wahlPaket(tx, dealRecordId, k.version, k.quotation.selectedPackageOptionId);
  const datum = await wahlDatum(tx, dealRecordId, k.version);
  const preis = wahlPreis(k.version, { paketSlug, datum });
  if (!preis) return "ohne_preis";
  await wahlSchreiben(tx, k.quotation.id, preis);
  return "geschrieben";
}
