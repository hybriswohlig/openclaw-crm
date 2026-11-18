/**
 * Welches Paket ein Dokument (KV, AB, RE) beschreibt und welche Hebel es enthält
 * (Rest-vier Punkt 1, Review I1/M1/M2). Eine Regel für beide Renderer (VPS über
 * `attachDocumentJobContext`, CRM-Vorlage über `commercial-documents`):
 *
 * 1. AB und RE mit aktiver Annahme: das angenommene Paket (`wahl.paketSlug` des
 *    Schnappschusses) an der Version des Schnappschusses (sonst der Quotation),
 *    genau wie der Preis der AB aus dem Schnappschuss kommt.
 * 2. Sonst die aktuelle Wahl der Quotation: gewählte, sonst empfohlene, sonst erste
 *    an die Version gebundene Option (`wahlPaket`, dieselbe Regel wie Portal,
 *    Kundenwahl und Annahme). Unabhängig davon, ob der Preis von Hand geändert
 *    wurde: ob Montage zum Auftrag gehört, hängt am gewählten Paket, nicht am Betrag.
 *
 * Hebel aus `paket_hebel` der Anfrage dieser Version (beim Rechnen eingefroren).
 * null ohne Pakete, ohne Festpreis-Version oder wenn die Anfrage das Paket nicht
 * kennt (Altbestand): dann bleibt alles wie bisher.
 */
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { dealCalculationVersions } from "@/db/schema/deal-calculation-versions";
import type { PaketpreisVersion } from "@/lib/angebot-wahl";
import { paketHebelAus, type HebelArt } from "@/services/rechner/kv-posten";
import type { RechnerAnfrage } from "@/services/rechner/eingabe";
import { wahlPaket } from "./kundenwahl";

export interface PaketDesDokuments {
  slug: string;
  hebel: HebelArt[];
  /** Anfrage der Version (Adressen für die Leistungstexte). */
  anfrage: RechnerAnfrage | null;
}

export interface PaketQuotation {
  isVariable: boolean;
  calculationVersionId?: string | null;
  selectedPackageOptionId?: string | null;
}

/** Angenommene Wahl aus `kva_confirmations.quotation_snapshot`; null ohne Wahl im Schnappschuss. */
export function annahmeWahlAus(snapshot: unknown): { paketSlug: string | null; versionId: string | null } | null {
  if (!snapshot || typeof snapshot !== "object") return null;
  const s = snapshot as { wahl?: unknown; calculationVersionId?: unknown };
  if (!s.wahl || typeof s.wahl !== "object") return null;
  const slug = (s.wahl as { paketSlug?: unknown }).paketSlug;
  return {
    paketSlug: typeof slug === "string" && slug ? slug : null,
    versionId: typeof s.calculationVersionId === "string" && s.calculationVersionId ? s.calculationVersionId : null,
  };
}

async function ladeVersion(dealRecordId: string, versionId: string) {
  const [v] = await db
    .select({
      id: dealCalculationVersions.id,
      pricingMode: dealCalculationVersions.pricingMode,
      packagePrices: dealCalculationVersions.packagePrices,
      rechnerRequest: dealCalculationVersions.rechnerRequest,
    })
    .from(dealCalculationVersions)
    .where(and(eq(dealCalculationVersions.id, versionId), eq(dealCalculationVersions.dealRecordId, dealRecordId)))
    .limit(1);
  return v ?? null;
}

function ergebnis(slug: string | null, rechnerRequest: unknown): PaketDesDokuments | null {
  if (!slug) return null;
  const anfrage = (rechnerRequest ?? null) as RechnerAnfrage | null;
  const hebel = paketHebelAus(anfrage, slug);
  return hebel ? { slug, hebel, anfrage } : null;
}

export async function paketDesDokuments(input: {
  dealRecordId: string;
  kind: string;
  quotation: PaketQuotation | null;
  /** Schnappschuss der aktiven Annahme (nur für AB und RE gelesen). */
  annahmeSnapshot?: unknown;
}): Promise<PaketDesDokuments | null> {
  const { dealRecordId, quotation } = input;
  const art = input.kind.toUpperCase();
  if (art === "AB" || art === "RE") {
    const wahl = annahmeWahlAus(input.annahmeSnapshot);
    if (wahl) {
      const versionId = wahl.versionId ?? quotation?.calculationVersionId ?? null;
      if (!wahl.paketSlug || !versionId) return null;
      const v = await ladeVersion(dealRecordId, versionId);
      return v ? ergebnis(wahl.paketSlug, v.rechnerRequest) : null;
    }
  }
  if (!quotation || quotation.isVariable || !quotation.calculationVersionId) return null;
  const v = await ladeVersion(dealRecordId, quotation.calculationVersionId);
  const packagePrices = (Array.isArray(v?.packagePrices) ? v.packagePrices : []) as PaketpreisVersion[];
  if (!v || v.pricingMode !== "fest" || packagePrices.length === 0) return null;
  const slug = await wahlPaket(
    db,
    dealRecordId,
    { id: v.id, pricingMode: "fest", priceCents: null, kvItems: [], packagePrices, dayPrices: [] },
    quotation.selectedPackageOptionId ?? null
  );
  return ergebnis(slug, v.rechnerRequest);
}
