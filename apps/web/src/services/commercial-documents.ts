import { and, desc, eq } from "drizzle-orm";
import {
  MissingPriceError,
  buildDocumentModel,
  priceSourceFromStored,
  hourlyFromDetails,
  renderHtml,
  renderPdf,
  TEMPLATE_VERSION,
  type AcceptedPrice,
  type DocKind,
  type DocumentCopy,
  type DocumentModel,
  type FirmaSlug,
  type OfferChoices,
  type PackageOptionPrice,
  type PriceLine,
  type RenderInput,
  companyFromTitle,
  letterheadFromValues,
} from "@openclaw-crm/document-templates";
import { db } from "@/db";
import { attributes, objects } from "@/db/schema/objects";
import { records, recordValues } from "@/db/schema/records";
import { inboxConversations, inboxMessages } from "@/db/schema/inbox";
import { payments } from "@/db/schema/financial";
import {
  customerDateSelections,
  kvaConfirmations,
  quotationPackageOptions,
} from "@/db/schema/customer-portal";
import { dealCalculationVersions } from "@/db/schema/deal-calculation-versions";
import {
  standardWahl,
  wahlPreis,
  type AngebotsWahl,
  type PaketpreisVersion,
  type Tagespreis,
  type VersionsPreise,
} from "@/lib/angebot-wahl";
import type { KvPosten } from "@/services/rechner/kv-posten";
import { formatLocation } from "@/lib/deal-doc-data";
import { preisQuelleAusAnnahme } from "@/lib/ab-preise";
import { assertDealInWorkspace } from "@/services/document-job-context";
import { angebotSperren, getQuotation, quotationLesen } from "@/services/quotations";
import { resolveDocCustomerName } from "@/services/doc-customer-name";
import { loadCustomerEmail } from "@/services/customer-portal-emails";
import { getRecord } from "@/services/records";
import {
  createDealDocument,
  type DealDocumentMeta,
  type DealDocumentType,
} from "@/services/deal-documents";
import { applyInvoiceDueDate } from "@/services/rechnung-faellig";
import { ladeSteuernummer } from "@/services/company-settings";
import {
  angebotsStandAus,
  nachRechnung,
  rechnungPruefenUndReservieren,
  rechnungStellen,
} from "@/services/rechnungen";
import { GeldFehler, rechnungsDateiStamm, type RechnungEingabe, type RechnungZeile } from "@/lib/geld";
import { dealDokumentNachlauf } from "@/services/deal-documents";
import { berlinCalendarDay } from "@/lib/invoice-due-date";
import { anredeFuerOptOut, ladeGespeicherteAnrede } from "@/services/agent/agent-suppress";
import { aktivBedingung } from "@/services/kva-annahme";
import { preisZahlungenCent } from "@/lib/preis-zahlungen";
import {
  KOTTKE_CRM_RENDERER_MESSAGE,
  blocksInRepoCrmRenderer,
} from "@/lib/kottke-crm-renderer";

export class CommercialDocumentError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code = "BAD_REQUEST"
  ) {
    super(message);
    this.name = "CommercialDocumentError";
  }
}

const STORE_TYPE: Record<DocKind, DealDocumentType> = {
  KV: "quotation",
  AB: "order_confirmation",
  RE: "invoice",
};

export function berlinToday(now = new Date()): string {
  return berlinCalendarDay(now);
}

function firmaFromCompany(name: string | null | undefined): FirmaSlug | null {
  if (!name) return null;
  const lower = name.toLowerCase();
  if (lower.includes("ceylan")) return "ceylan";
  if (lower.includes("kottke")) return "kottke";
  return null;
}

function addressLine(value: unknown): string | undefined {
  const formatted = formatLocation(value);
  if (!formatted || formatted === "—") return undefined;
  return formatted;
}

function isoDay(value: unknown): string | undefined {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  const iso = /^(\d{4}-\d{2}-\d{2})/.exec(trimmed);
  if (iso) return iso[1];
  const de = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(trimmed);
  if (!de) return undefined;
  return `${de[3]}-${de[2].padStart(2, "0")}-${de[1].padStart(2, "0")}`;
}

/**
 * Due date printed on the document. The job date is intentionally not a
 * fallback: a missing due date stays missing.
 */
export function documentDueDate(rechnungFaelligAm: unknown, depositDue: unknown): string | undefined {
  return isoDay(rechnungFaelligAm) ?? isoDay(depositDue);
}

/** Same rule as the opt-out footer: the latest customer text, else the stored register, else Sie. */
export function documentAddressForm(
  latestInbound: string | null | undefined,
  sources?: { deal?: string | null; conversation?: string | null }
): "sie" | "du" {
  return anredeFuerOptOut(latestInbound ?? "", {
    deal: sources?.deal,
    konversation: sources?.conversation,
  });
}

export function leadTypeFromPayload(value: unknown): string | null {
  let parsed = value;
  if (typeof parsed === "string") {
    const trimmed = parsed.trim();
    if (!trimmed) return null;
    try {
      parsed = JSON.parse(trimmed) as unknown;
    } catch {
      return null;
    }
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const record = parsed as Record<string, unknown>;
  const raw = record.leadType ?? record.LeadType;
  return typeof raw === "string" && raw.trim() ? raw.trim() : null;
}

function flag(value: unknown): boolean {
  return value === true || value === 1 || value === "true" || value === "1";
}

async function loadAddressForm(workspaceId: string, dealRecordId: string): Promise<"sie" | "du"> {
  try {
    const [conv] = await db
      .select({ id: inboxConversations.id })
      .from(inboxConversations)
      .where(
        and(
          eq(inboxConversations.workspaceId, workspaceId),
          eq(inboxConversations.dealRecordId, dealRecordId)
        )
      )
      .orderBy(desc(inboxConversations.lastMessageAt))
      .limit(1);
    const stored = await ladeGespeicherteAnrede({
      dealRecordId,
      conversationId: conv?.id ?? null,
    });
    let inbound = "";
    if (conv) {
      const [message] = await db
        .select({ body: inboxMessages.body })
        .from(inboxMessages)
        .where(
          and(eq(inboxMessages.conversationId, conv.id), eq(inboxMessages.direction, "inbound"))
        )
        .orderBy(desc(inboxMessages.createdAt))
        .limit(1);
      inbound = message?.body ?? "";
    }
    return documentAddressForm(inbound, {
      deal: stored.deal,
      conversation: stored.konversation,
    });
  } catch (err) {
    console.error("[commercial-documents] address form fell back to Sie", err);
    return "sie";
  }
}

async function loadServiceFlags(
  workspaceId: string,
  dealRecordId: string
): Promise<{
  pianoTransport: boolean;
  storageRequired: boolean;
  packing: boolean;
  assembly: boolean;
  auftragName: string | null;
}> {
  const empty = {
    pianoTransport: false,
    storageRequired: false,
    packing: false,
    assembly: false,
    auftragName: null,
  };
  try {
    const [auftragObj] = await db
      .select({ id: objects.id })
      .from(objects)
      .where(and(eq(objects.workspaceId, workspaceId), eq(objects.slug, "auftraege")))
      .limit(1);
    if (!auftragObj) return empty;
    const [dealRef] = await db
      .select({ id: attributes.id })
      .from(attributes)
      .where(and(eq(attributes.objectId, auftragObj.id), eq(attributes.slug, "deal")))
      .limit(1);
    if (!dealRef) return empty;
    const [ref] = await db
      .select({ recordId: recordValues.recordId })
      .from(recordValues)
      .innerJoin(records, eq(records.id, recordValues.recordId))
      .where(
        and(
          eq(records.objectId, auftragObj.id),
          eq(recordValues.attributeId, dealRef.id),
          eq(recordValues.referencedRecordId, dealRecordId)
        )
      )
      .limit(1);
    if (!ref) return empty;
    const rec = await getRecord(auftragObj.id, ref.recordId);
    const values = rec?.values ?? {};
    return {
      pianoTransport: flag(values.piano_transport),
      storageRequired: flag(values.storage_required),
      packing: flag(values.packing_service),
      assembly: flag(values.dismantling_required),
      auftragName: typeof values.name === "string" ? values.name : null,
    };
  } catch (err) {
    console.error("[commercial-documents] service flags unavailable", err);
    return empty;
  }
}

/** AB prices follow the accepted snapshot. Deposit and the rest stay on the quotation row. */
export function acceptedPriceFor(kind: DocKind, snapshot: unknown): AcceptedPrice | null {
  if (kind !== "AB") return null;
  const q = preisQuelleAusAnnahme(snapshot);
  if (!q) return null;
  // Stunden-KV aus der Version: die AB rechnet wie der KV mit der Schätzung.
  const hourly = q.stunden ? hourlyFromDetails({ stunden: q.stunden }) : null;
  return {
    isVariable: q.isVariable,
    fixedPrice: q.fixedPrice,
    lineItems: q.lineItems,
    ...(hourly ? { hourly } : {}),
  };
}

function refId(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const id = (value as { id?: unknown }).id;
  return typeof id === "string" && id ? id : null;
}

function refName(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const name = (value as { displayName?: unknown }).displayName;
  return typeof name === "string" && name.trim() ? name.trim() : null;
}

async function loadPersonContact(
  workspaceId: string,
  personId: string
): Promise<{ address?: string; companyName: string | null; companyId: string | null }> {
  const empty = { companyName: null, companyId: null };
  const [peopleObj] = await db
    .select({ id: objects.id })
    .from(objects)
    .where(and(eq(objects.workspaceId, workspaceId), eq(objects.slug, "people")))
    .limit(1);
  if (!peopleObj) return empty;
  const person = await getRecord(peopleObj.id, personId);
  return {
    address: addressLine(person?.values.location),
    companyName: refName(person?.values.company),
    companyId: refId(person?.values.company),
  };
}

async function loadCompanyAddress(
  workspaceId: string,
  companyId: string
): Promise<string | undefined> {
  const [companyObj] = await db
    .select({ id: objects.id })
    .from(objects)
    .where(and(eq(objects.workspaceId, workspaceId), eq(objects.slug, "companies")))
    .limit(1);
  if (!companyObj) return undefined;
  const company = await getRecord(companyObj.id, companyId);
  return addressLine(company?.values.primary_location);
}

/** Deal-Paketoption, wie sie für die wählbaren Optionen gebraucht wird. */
export interface WahlOption {
  id: string;
  catalogueSlug: string | null;
  displayName: string;
  isRecommended: boolean;
  sortOrder: number;
  calculationVersionId: string | null;
}

/** Was eine gesperrte Version für den KV beiträgt (nur Kundenpreise und Posten). */
export type WahlVersion = Pick<VersionsPreise, "pricingMode" | "priceCents" | "kvItems" | "packagePrices" | "dayPrices"> & {
  id: string;
};

function alsPreisZeilen(posten: readonly KvPosten[]): PriceLine[] {
  return posten.map((p) => ({
    type: "other",
    description: p.description,
    quantity: p.quantity,
    unitRate: Number(p.unitRate).toFixed(2),
  }));
}

/**
 * Alle Wahlen eines KVs aus der gesperrten Version (Plan 5b, Entscheidung 11).
 *
 * Pakete sind die Deal-Optionen, die das Sperren aus genau dieser Version
 * geschrieben hat (`calculation_version_id`, `catalogue_slug`); Optionen von
 * Hand haben den Bezug gelöst und zählen nicht. Tage sind `day_prices`. Jeder
 * Preis kommt aus `wahlPreis`, also derselben Regel wie Portal und Annahme.
 * Die aktuelle Wahl ist die gebundene Option (sonst die empfohlene) am Tag der
 * Kundenwahl (sonst am empfohlenen Tag); trägt die Quotation nicht genau ihren
 * Preis, gibt es keinen Block (null), und das PDF bleibt wie heute.
 * Selbstkosten, Marge und Gründe der Version gehen nie hinein.
 */
export function wahlenAusVersion(input: {
  version: WahlVersion;
  optionen: readonly WahlOption[];
  gewaehlteOptionId: string | null;
  gewaehltesDatum: string | null;
  festpreisCent: number | null;
}): { choices: OfferChoices; priceCents: number } | null {
  const { version } = input;
  if (version.pricingMode !== "fest" || input.festpreisCent === null) return null;
  const preise: VersionsPreise = {
    pricingMode: version.pricingMode,
    priceCents: version.priceCents,
    kvItems: version.kvItems ?? [],
    packagePrices: version.packagePrices ?? [],
    dayPrices: version.dayPrices ?? [],
  };
  const versionsSlugs = new Set(preise.packagePrices.map((p) => p.slug));
  const pakete: WahlOption[] = [];
  for (const o of [...input.optionen].sort((a, b) => a.sortOrder - b.sortOrder)) {
    const slug = o.catalogueSlug;
    if (!slug || o.calculationVersionId !== version.id || !versionsSlugs.has(slug)) continue;
    if (pakete.some((p) => p.catalogueSlug === slug)) continue;
    pakete.push(o);
  }
  const tage = [...new Set(preise.dayPrices.map((t) => t.datum))].sort();
  if (pakete.length === 0 && tage.length === 0) return null;

  const zellen: AngebotsWahl[] = [];
  if (pakete.length > 0 && tage.length > 0) {
    for (const datum of tage) for (const p of pakete) zellen.push({ paketSlug: p.catalogueSlug, datum });
  } else if (pakete.length > 0) {
    for (const p of pakete) zellen.push({ paketSlug: p.catalogueSlug, datum: null });
  } else {
    for (const datum of tage) zellen.push({ paketSlug: null, datum });
  }

  let paketSlug: string | null = null;
  if (pakete.length > 0) {
    const gebunden = pakete.find((p) => p.id === input.gewaehlteOptionId) ?? pakete.find((p) => p.isRecommended);
    if (!gebunden) return null;
    paketSlug = gebunden.catalogueSlug;
  }
  let datum: string | null = null;
  if (tage.length > 0) {
    datum =
      input.gewaehltesDatum && tage.includes(input.gewaehltesDatum)
        ? input.gewaehltesDatum
        : standardWahl(preise, paketSlug).datum;
  }
  const aktuell = wahlPreis(preise, { paketSlug, datum });
  if (!aktuell || aktuell.priceCents !== input.festpreisCent) return null;

  return {
    priceCents: aktuell.priceCents,
    choices: {
      packages: pakete.map((p) => ({ slug: p.catalogueSlug as string, name: p.displayName })),
      days: tage,
      prices: zellen.map((z) => ({
        packageSlug: z.paketSlug,
        date: z.datum,
        priceCents: wahlPreis(preise, z)?.priceCents ?? null,
      })),
      current: { packageSlug: paketSlug, date: datum },
      currentLines: aktuell.kvItems.length > 0 ? alsPreisZeilen(aktuell.kvItems) : null,
    },
  };
}

/** Liest Version, Deal-Optionen und Kundenwahl für `wahlenAusVersion`; ohne Version null. */
async function ladeWahlen(
  workspaceId: string,
  dealRecordId: string,
  quotation: {
    calculationVersionId?: string | null;
    isVariable: boolean;
    fixedPrice: string | null;
    selectedPackageOptionId?: string | null;
  }
): Promise<{ choices: OfferChoices; priceCents: number } | null> {
  const versionId = quotation.calculationVersionId ?? null;
  if (!versionId || quotation.isVariable) return null;
  const festpreis = quotation.fixedPrice != null && quotation.fixedPrice !== "" ? Number(quotation.fixedPrice) : NaN;
  if (!Number.isFinite(festpreis)) return null;
  const [version] = await db
    .select({
      id: dealCalculationVersions.id,
      pricingMode: dealCalculationVersions.pricingMode,
      priceCents: dealCalculationVersions.priceCents,
      kvItems: dealCalculationVersions.kvItems,
      packagePrices: dealCalculationVersions.packagePrices,
      dayPrices: dealCalculationVersions.dayPrices,
    })
    .from(dealCalculationVersions)
    .where(
      and(
        eq(dealCalculationVersions.id, versionId),
        eq(dealCalculationVersions.workspaceId, workspaceId),
        eq(dealCalculationVersions.dealRecordId, dealRecordId),
        eq(dealCalculationVersions.status, "gesperrt")
      )
    )
    .limit(1);
  if (!version) return null;
  const [optionen, auswahl] = await Promise.all([
    db
      .select({
        id: quotationPackageOptions.id,
        catalogueSlug: quotationPackageOptions.catalogueSlug,
        displayName: quotationPackageOptions.displayName,
        isRecommended: quotationPackageOptions.isRecommended,
        sortOrder: quotationPackageOptions.sortOrder,
        calculationVersionId: quotationPackageOptions.calculationVersionId,
      })
      .from(quotationPackageOptions)
      .where(
        and(
          eq(quotationPackageOptions.dealRecordId, dealRecordId),
          eq(quotationPackageOptions.workspaceId, workspaceId)
        )
      ),
    db
      .select({ selectedDate: customerDateSelections.selectedDate })
      .from(customerDateSelections)
      .where(
        and(
          eq(customerDateSelections.dealRecordId, dealRecordId),
          eq(customerDateSelections.workspaceId, workspaceId)
        )
      )
      .limit(1),
  ]);
  return wahlenAusVersion({
    version: {
      id: version.id,
      pricingMode: version.pricingMode,
      priceCents: version.priceCents,
      kvItems: (version.kvItems ?? []) as KvPosten[],
      packagePrices: (version.packagePrices ?? []) as PaketpreisVersion[],
      dayPrices: (version.dayPrices ?? []) as Tagespreis[],
    },
    optionen: optionen ?? [],
    gewaehlteOptionId: quotation.selectedPackageOptionId ?? null,
    gewaehltesDatum: isoDay(auswahl?.[0]?.selectedDate) ?? null,
    festpreisCent: Math.round(festpreis * 100),
  });
}

export async function loadCommercialModel(input: {
  workspaceId: string;
  dealRecordId: string;
  kind: DocKind;
  copy?: DocumentCopy;
  now?: Date;
}): Promise<DocumentModel> {
  return (await ladeModellMitVersion(input)).model;
}

/**
 * Modell und die Kalkulationsversion der Quotation, aus der es gebaut wurde
 * (`quotations.calculation_version_id` genau dieses Lesens, null ohne Version).
 */
async function ladeModellMitVersion(input: {
  workspaceId: string;
  dealRecordId: string;
  kind: DocKind;
  copy?: DocumentCopy;
  now?: Date;
  /**
   * Nur RE eines Stunden-KVs (Plan 9): der bestätigte Rechnungsbetrag. Das PDF
   * druckt ihn als eine Preiszeile; ohne Betrag wird keine Stunden-Rechnung gebaut.
   */
  stundenRechnungCent?: number | null;
}): Promise<{
  model: DocumentModel;
  calculationVersionId: string | null;
  renderInput: RenderInput;
  /** Stand der Quotation, aus dem gerendert wurde (Vergleich unter der Angebots-Sperre). */
  angebotsStand: string;
  istStunden: boolean;
}> {
  const { workspaceId, dealRecordId, kind } = input;
  if (!(await assertDealInWorkspace(workspaceId, dealRecordId))) {
    throw new CommercialDocumentError("Auftrag nicht gefunden.", 404, "NOT_FOUND");
  }

  const [dealObj] = await db
    .select({ id: objects.id })
    .from(objects)
    .where(and(eq(objects.workspaceId, workspaceId), eq(objects.slug, "deals")))
    .limit(1);
  const deal = dealObj ? await getRecord(dealObj.id, dealRecordId) : null;
  if (!deal) {
    throw new CommercialDocumentError("Auftrag nicht gefunden.", 404, "NOT_FOUND");
  }

  const company = deal.values.operating_company as { displayName?: string } | null;
  const companyName = refName(company) ?? company?.displayName ?? null;
  const firma = firmaFromCompany(companyName);
  if (
    blocksInRepoCrmRenderer({
      firma,
      operatingCompanyId: refId(company),
      operatingCompanyName: companyName,
    })
  ) {
    throw new CommercialDocumentError(KOTTKE_CRM_RENDERER_MESSAGE, 400);
  }
  if (!firma) {
    throw new CommercialDocumentError("Firma (Kottke oder Ceylan) fehlt auf dem Auftrag.", 400);
  }

  const customer = await resolveDocCustomerName(workspaceId, dealRecordId);
  if (!customer) {
    throw new CommercialDocumentError("Kundenname fehlt auf dem Auftrag.", 400);
  }

  // Kopf (mit Versionsbezug) und Posten aus demselben Stand.
  const quotation = await getQuotation(dealRecordId, { konsistent: true });
  if (!quotation) {
    throw new CommercialDocumentError(
      "Kein gespeichertes Angebot. Preise kommen nur aus dem Kostenvoranschlag.",
      400
    );
  }

  const [accepted] = await db
    .select({ quotationSnapshot: kvaConfirmations.quotationSnapshot })
    .from(kvaConfirmations)
    .where(and(eq(kvaConfirmations.workspaceId, workspaceId), aktivBedingung(dealRecordId)))
    .limit(1);

  const stundenRechnung = kind === "RE" && quotation.isVariable;
  if (stundenRechnung && (input.stundenRechnungCent == null || input.stundenRechnungCent <= 0)) {
    throw new GeldFehler("STUNDEN_BETRAG_FEHLT");
  }

  let packageOption: PackageOptionPrice | null = null;
  if (kind !== "AB" && quotation.selectedPackageOptionId && !quotation.isVariable) {
    const [option] = await db
      .select({
        displayName: quotationPackageOptions.displayName,
        priceCents: quotationPackageOptions.priceCents,
        includedItems: quotationPackageOptions.includedItems,
      })
      .from(quotationPackageOptions)
      .where(
        and(
          eq(quotationPackageOptions.id, quotation.selectedPackageOptionId),
          eq(quotationPackageOptions.dealRecordId, dealRecordId),
          eq(quotationPackageOptions.workspaceId, workspaceId)
        )
      )
      .limit(1);
    if (option) {
      packageOption = {
        displayName: option.displayName,
        priceCents: option.priceCents,
        includedItems: option.includedItems ?? [],
      };
    }
  }

  // Plan 5b: alle Wahlen der gesperrten Version. Nur wenn die Quotation genau
  // eine davon trägt; der Preis der Wahl (Paket am Tag) gilt dann auch für die
  // Option, deren Zeile nur den Paketpreis am Basistag kennt.
  const wahlen = kind === "KV" ? await ladeWahlen(workspaceId, dealRecordId, quotation) : null;
  if (wahlen && packageOption) {
    packageOption = { ...packageOption, priceCents: wahlen.priceCents };
  }

  const people = deal.values.associated_people;
  const personId =
    Array.isArray(people) && people[0] && typeof people[0] === "object" && "id" in people[0]
      ? String((people[0] as { id: string }).id)
      : null;

  const ocId = refId(deal.values.operating_company);
  const [email, personContact, paidRow, flags, addressForm, letterheadValues, steuernummer] = await Promise.all([
    loadCustomerEmail(workspaceId, dealRecordId),
    personId
      ? loadPersonContact(workspaceId, personId)
      : Promise.resolve({ address: undefined, companyName: null, companyId: null }),
    db
      .select({ amount: payments.amount, taxTreatment: payments.taxTreatment })
      .from(payments)
      .where(and(eq(payments.workspaceId, workspaceId), eq(payments.dealRecordId, dealRecordId))),
    loadServiceFlags(workspaceId, dealRecordId),
    loadAddressForm(workspaceId, dealRecordId),
    (async () => {
      if (!ocId) return null;
      const [ocObj] = await db
        .select({ id: objects.id })
        .from(objects)
        .where(and(eq(objects.workspaceId, workspaceId), eq(objects.slug, "operating_companies")))
        .limit(1);
      if (!ocObj) return null;
      const oc = await getRecord(ocObj.id, ocId);
      return oc?.values ?? null;
    })(),
    kind === "RE" ? ladeSteuernummer(workspaceId, ocId) : Promise.resolve(null),
  ]);

  const linkedCompany =
    refName(deal.values.company) ?? personContact.companyName ?? null;
  const customerCompany =
    linkedCompany ??
    companyFromTitle(typeof deal.values.name === "string" ? deal.values.name : null);
  const companyId = refId(deal.values.company) ?? personContact.companyId;
  let customerAddress = personContact.address;
  if (!customerAddress && companyId) {
    customerAddress = await loadCompanyAddress(workspaceId, companyId);
  }
  const inventoryNotes =
    typeof deal.values.inventory_notes === "string" ? deal.values.inventory_notes : "";
  const dealTitle = typeof deal.values.name === "string" ? deal.values.name : "";

  // Kaution und durchlaufende Posten sind keine Zahlung auf die Rechnung.
  const paidCents = preisZahlungenCent(paidRow);

  const preisQuelle = priceSourceFromStored(quotation);
  const renderQuelle = stundenRechnung
    ? (() => {
        const euro = (input.stundenRechnungCent! / 100).toFixed(2);
        return {
          ...preisQuelle,
          isVariable: false,
          fixedPrice: euro,
          hourly: null,
          lineItems: [{ type: "pauschale", description: "Leistung nach Aufwand", quantity: 1, unitRate: euro }],
        };
      })()
    : preisQuelle;

  try {
    const renderInput: RenderInput = {
      kind,
      deal: {
        firma,
        customerName: customer.fullName,
        customerCompany,
        customerEmail: email ?? undefined,
        customerAddress,
        fromAddress: addressLine(deal.values.move_from_address),
        toAddress: addressLine(deal.values.move_to_address),
        serviceDate: isoDay(deal.values.move_date),
        documentDate: berlinToday(input.now),
        givenName: customer.vorname,
        letterhead: letterheadFromValues(letterheadValues),
        addressForm: customerCompany ? "sie" : addressForm,
        dueDate: documentDueDate(
          deal.values.rechnung_faellig_am,
          quotation.documentDetails?.depositDue
        ),
        ...(steuernummer ? { taxNumber: steuernummer } : {}),
      },
      service: {
        showStandardInclusions: quotation.showStandardInclusions,
        leadType: leadTypeFromPayload(deal.values.moving_lead_payload),
        pianoTransport: flags.pianoTransport,
        storageRequired: flags.storageRequired,
        packing: flags.packing,
        assembly: flags.assembly,
        inventory: inventoryNotes.trim().length > 0,
        title: [dealTitle, flags.auftragName].filter(Boolean).join(" "),
        mention: [quotation.summary, inventoryNotes].filter(Boolean).join(" "),
      },
      quotation: renderQuelle,
      accepted: acceptedPriceFor(kind, accepted?.quotationSnapshot),
      packageOption: stundenRechnung ? null : packageOption,
      choices: wahlen?.choices ?? null,
      paidCents,
      copy: input.copy,
    };
    const model = buildDocumentModel(renderInput);
    return {
      model,
      calculationVersionId: quotation.calculationVersionId ?? null,
      renderInput,
      angebotsStand: angebotsStandAus(quotation),
      istStunden: quotation.isVariable,
    };
  } catch (err) {
    if (err instanceof MissingPriceError) {
      throw new CommercialDocumentError(err.message, 400);
    }
    throw err;
  }
}

export interface RenderedCommercialDocument {
  model: DocumentModel;
  html: string;
  pdf: Uint8Array;
  fileName: string;
  templateVersion: string;
  /** Kalkulationsversion der Quotation, aus der gerendert wurde (null ohne Version). */
  calculationVersionId: string | null;
}

export async function previewCommercialDocument(input: {
  workspaceId: string;
  dealRecordId: string;
  kind: DocKind;
  copy?: DocumentCopy;
}): Promise<RenderedCommercialDocument> {
  const { model, calculationVersionId } = await ladeModellMitVersion(input);
  const pdf = await renderPdf(model);
  return {
    model,
    html: renderHtml(model),
    pdf,
    fileName: `${model.fileStem}.pdf`,
    templateVersion: TEMPLATE_VERSION,
    calculationVersionId,
  };
}

export async function storeCommercialDocument(input: {
  workspaceId: string;
  dealRecordId: string;
  kind: DocKind;
  copy?: DocumentCopy;
  notifyCustomer?: boolean;
  /** Kept when present. Otherwise an RE is due on the invoice day. */
  dueDate?: string | null;
  updatedBy?: string | null;
  now?: Date;
  /**
   * Läuft nach dem Rendern mit der Kalkulationsversion der gerenderten Quotation.
   * Wirft sie, wird nichts gespeichert (KV aus einer bestimmten Version).
   */
  pruefeVersion?: (calculationVersionId: string | null) => void | Promise<void>;
  /** Nur RE: Betrag und Grund aus dem Rechnungsschritt (Plan 9). */
  rechnung?: RechnungEingabe | null;
  /** Aufruf über einen API-Schlüssel (MCP, Agent): Abweichung und Stunden nie. */
  durchAgent?: boolean;
}): Promise<{
  document: DealDocumentMeta;
  templateVersion: string;
  fileName: string;
  rechnungFaelligAm: string | null;
  dueDateWarning?: string;
  rechnung?: RechnungZeile;
}> {
  if (input.kind === "RE") return storeRechnungCrm(input);
  const rendered = await previewCommercialDocument(input);
  if (input.pruefeVersion) await input.pruefeVersion(rendered.calculationVersionId);
  return persistCommercialDocument({
    workspaceId: input.workspaceId,
    dealRecordId: input.dealRecordId,
    kind: input.kind,
    pdf: rendered.pdf,
    fileStem: rendered.model.fileStem,
    templateVersion: rendered.templateVersion,
    calculationVersionId: rendered.calculationVersionId,
    notifyCustomer: input.notifyCustomer,
    dueDate: input.dueDate,
    updatedBy: input.updatedBy,
    now: input.now,
  });
}

/**
 * RE über den CRM-Renderer (Plan 9, Entscheidung 6): Modell außerhalb, dann in
 * einer Transaktion unter der Angebots-Sperre Stand vergleichen, prüfen, Nummer
 * reservieren, mit Nummer und Fälligkeit rendern, PDF und Datensatz `gestellt`
 * speichern. Scheitert etwas, rollt der Zähler mit zurück. Nachläufe nach dem Commit.
 */
async function storeRechnungCrm(input: {
  workspaceId: string;
  dealRecordId: string;
  copy?: DocumentCopy;
  notifyCustomer?: boolean;
  dueDate?: string | null;
  updatedBy?: string | null;
  now?: Date;
  rechnung?: RechnungEingabe | null;
  durchAgent?: boolean;
}) {
  const jetzt = input.now ?? new Date();
  const eingabe: RechnungEingabe = {
    bruttoCent: input.rechnung?.bruttoCent ?? null,
    abweichungGrund: input.rechnung?.abweichungGrund ?? null,
    faelligAm: input.dueDate ?? input.rechnung?.faelligAm ?? null,
  };
  const vorab = await ladeModellMitVersion({
    workspaceId: input.workspaceId,
    dealRecordId: input.dealRecordId,
    kind: "RE",
    copy: input.copy,
    now: jetzt,
    stundenRechnungCent: eingabe.bruttoCent,
  });
  const stunden = vorab.istStunden;

  const ergebnis = await db.transaction(async (tx) => {
    await angebotSperren(tx, input.dealRecordId);
    const jetztStand = await quotationLesen(tx, input.dealRecordId);
    if (!jetztStand || angebotsStandAus(jetztStand) !== vorab.angebotsStand) {
      throw new GeldFehler("RECHNUNG_PDF_ANDERS", "Das Angebot hat sich gerade geändert. Bitte die Rechnung neu erstellen.");
    }
    const zeile = await rechnungPruefenUndReservieren(tx, {
      ws: input.workspaceId,
      deal: input.dealRecordId,
      herkunft: "crm",
      pdfBetragCent: stunden ? null : vorab.model.totalCents,
      eingabe,
      durchAgent: input.durchAgent === true,
      userId: input.updatedBy ?? null,
      jetzt,
    });
    const model = buildDocumentModel({
      ...vorab.renderInput,
      deal: { ...vorab.renderInput.deal, invoiceNumber: zeile.nummer ?? undefined, dueDate: zeile.faelligAm ?? undefined },
    });
    if (model.totalCents !== zeile.bruttoCent) {
      throw new GeldFehler("RECHNUNG_PDF_ANDERS");
    }
    const pdf = await renderPdf(model);
    const stamm = zeile.nummer ? rechnungsDateiStamm(zeile.nummer, vorab.renderInput.deal.firma) : model.fileStem;
    const fileName = `${stamm}.pdf`;
    const document = await createDealDocument(
      {
        workspaceId: input.workspaceId,
        dealRecordId: input.dealRecordId,
        documentType: "invoice",
        fileName,
        fileSize: pdf.byteLength,
        mimeType: "application/pdf",
        fileContent: Buffer.from(pdf).toString("base64"),
        notifyCustomer: input.notifyCustomer === true,
      },
      tx
    );
    await rechnungStellen(tx, zeile.id, document.id);
    return { document, fileName, zeile: { ...zeile, status: "gestellt" as const, dealDocumentId: document.id } };
  });

  await dealDokumentNachlauf(
    { workspaceId: input.workspaceId, dealRecordId: input.dealRecordId, notifyCustomer: input.notifyCustomer === true },
    "invoice"
  );
  await nachRechnung(input.workspaceId, input.dealRecordId, input.updatedBy ?? null);
  return {
    document: ergebnis.document,
    templateVersion: TEMPLATE_VERSION,
    fileName: ergebnis.fileName,
    rechnungFaelligAm: ergebnis.zeile.faelligAm,
    rechnung: ergebnis.zeile,
  };
}

/** Stores an already rendered PDF and, for an RE, stamps Rechnung fällig am. */
export async function persistCommercialDocument(input: {
  workspaceId: string;
  dealRecordId: string;
  kind: DocKind;
  pdf: Uint8Array;
  fileStem: string;
  templateVersion: string;
  /** Kalkulationsversion der gerenderten Quotation; gespeichert nur beim KV. */
  calculationVersionId?: string | null;
  notifyCustomer?: boolean;
  dueDate?: string | null;
  updatedBy?: string | null;
  now?: Date;
}): Promise<{
  document: DealDocumentMeta;
  templateVersion: string;
  fileName: string;
  rechnungFaelligAm: string | null;
  dueDateWarning?: string;
}> {
  const suffix = crypto.randomUUID().slice(0, 8);
  const fileName = `${input.fileStem}-${suffix}.pdf`;
  const document = await createDealDocument({
    workspaceId: input.workspaceId,
    dealRecordId: input.dealRecordId,
    documentType: STORE_TYPE[input.kind],
    fileName,
    fileSize: input.pdf.byteLength,
    mimeType: "application/pdf",
    fileContent: Buffer.from(input.pdf).toString("base64"),
    notifyCustomer: input.notifyCustomer === true,
    calculationVersionId: input.kind === "KV" ? input.calculationVersionId ?? null : null,
  });
  const due =
    input.kind === "RE"
      ? await applyInvoiceDueDate({
          documentType: "invoice",
          workspaceId: input.workspaceId,
          dealRecordId: input.dealRecordId,
          explicitDueDate: input.dueDate,
          updatedBy: input.updatedBy ?? null,
          now: input.now,
        })
      : { rechnungFaelligAm: null as string | null };
  return {
    document,
    templateVersion: input.templateVersion,
    fileName,
    rechnungFaelligAm: due.rechnungFaelligAm,
    ...("dueDateWarning" in due && due.dueDateWarning
      ? { dueDateWarning: due.dueDateWarning }
      : {}),
  };
}
