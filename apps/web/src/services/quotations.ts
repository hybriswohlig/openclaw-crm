import { db } from "@/db";
import { quotations, quotationLineItems, dealEmployees, employees } from "@/db/schema";
import type { CalculationAssumptions, QuotationDocumentDetails } from "@/db/schema/quotations";
import {
  applyDiscountToLines,
  normalizeLineItem,
  parseDiscount,
  type StoredLine,
} from "@/lib/angebots-rabatt";
import { annahmenZusammenfuehren } from "@/lib/kunden-annahmen";
import { eq, sql } from "drizzle-orm";
import { pruefeNichtAngenommen } from "./kva-annahme";
import type { UebernahmeErgebnis } from "./rechner/uebernahme";

export { QuotationInputError } from "@/lib/angebots-rabatt";

/** db client or transaction handle, so writes can run inside a transaction */
type DbExecutor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Eingabe fürs Angebot aus einer Kalkulation (angebotsUebernahme). */
export type AngebotsEingabe = Extract<UebernahmeErgebnis, { ok: true }>["eingabe"];
export type Quotation = NonNullable<Awaited<ReturnType<typeof getQuotation>>>;

/**
 * Sperrt das Angebot des Deals bis zum Ende der Transaktion `tx`. Wer die Quotation
 * schreibt (Sperren einer Kalkulationsversion, Angebotsformular), nimmt diese Sperre
 * zuerst; so laufen Lesen, Vergleichen und Schreiben nie ineinander.
 */
export async function angebotSperren(tx: DbExecutor, dealRecordId: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext('angebot:' || ${dealRecordId}::text))`);
}

async function quotationLesen(ex: DbExecutor, dealRecordId: string) {
  const [q] = await ex
    .select()
    .from(quotations)
    .where(eq(quotations.dealRecordId, dealRecordId))
    .limit(1);

  if (!q) return null;

  const lineItems = await ex
    .select()
    .from(quotationLineItems)
    .where(eq(quotationLineItems.quotationId, q.id))
    .orderBy(quotationLineItems.sortOrder);

  return { ...q, lineItems };
}

/**
 * Quotation mit Posten. `konsistent`: Kopf und Posten aus einem Stand (eine lesende
 * Transaktion mit REPEATABLE READ). Das braucht, wer daraus ein Dokument rendert und
 * die Kalkulationsversion des Kopfs daran hängt: sonst könnte zwischen beiden Abfragen
 * eine neue Version committen und das PDF Posten von v2 mit dem Bezug auf v1 tragen.
 */
export async function getQuotation(dealRecordId: string, opts?: { konsistent?: boolean }) {
  if (!opts?.konsistent) return quotationLesen(db, dealRecordId);
  return db.transaction((tx) => quotationLesen(tx, dealRecordId), {
    isolationLevel: "repeatable read",
    accessMode: "read only",
  });
}

type VergleichsPosten = {
  type: string;
  description: string | null;
  quantity: number;
  unitRate: string | number;
  sortOrder: number;
};

/** Euro-Betrag als Cent; leer → null, keine Zahl → der Rohtext (zählt dann als Änderung). */
function alsCent(value: string | number | null | undefined): number | string | null {
  if (value == null || (typeof value === "string" && value.trim() === "")) return null;
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n * 100) : String(value);
}

function postenSchluessel(lines: readonly VergleichsPosten[]): string {
  return JSON.stringify(
    lines
      .map((li, index) => ({ li, index }))
      .sort((a, b) => a.li.sortOrder - b.li.sortOrder || a.index - b.index)
      .map(({ li }) => [li.type, li.description?.trim() || null, li.quantity, alsCent(li.unitRate)])
  );
}

/**
 * Ob Festpreis (als Cent), isVariable oder die Posten (Reihenfolge, Typ, Text,
 * Menge, Einzelpreis in Cent) vom gespeicherten Stand abweichen.
 */
function angebotGeaendert(
  gespeichert: { fixedPrice: string | null; isVariable: boolean; lineItems: readonly VergleichsPosten[] },
  neu: { fixedPrice: string | null; isVariable: boolean; lineItems: readonly VergleichsPosten[] }
): boolean {
  return (
    alsCent(gespeichert.fixedPrice) !== alsCent(neu.fixedPrice) ||
    gespeichert.isVariable !== neu.isVariable ||
    postenSchluessel(gespeichert.lineItems) !== postenSchluessel(neu.lineItems)
  );
}

export async function upsertQuotation(
  dealRecordId: string,
  input: {
    fixedPrice?: string | null;
    isVariable: boolean;
    notes?: string | null;
    /** Anzahlung in cents — gates Stage 2 in the customer portal when set. */
    depositRequiredCents?: number | null;
    /** Per-deal payment method shown to the customer. */
    paymentMethodPreference?: "bank_transfer" | "paypal" | "cash" | "card" | null;
    /** ISO date — offer valid until. */
    validUntil?: string | null;
    /** Customer-facing free-text description of what the offer covers. */
    summary?: string | null;
    /** Whether to render the standard move inclusions on the portal. */
    showStandardInclusions?: boolean;
    /** Selected offer package slug (per operating company). */
    selectedPackageSlug?: string | null;
    /** Kalkulationsgrundlagen (Anfahrt, Etagen, Zugang, Inventarbasis) —
     *  landen über loadKvaSnapshot in der eingefrorenen KVA-Bestätigung. */
    calculationAssumptions?: CalculationAssumptions | null;
    /** Angaben für den KV (Leistungen, Gültigkeit); wird mit dem Bestand zusammengeführt. */
    documentDetails?: QuotationDocumentDetails | null;
    lineItems?: Array<{
      id?: string;
      type: "helper" | "transporter" | "other" | string;
      description?: string;
      quantity: number;
      unitRate: string | number;
      sortOrder: number;
    }>;
    /**
     * Rabatt auf den Festpreis. amount ist der Nachlass in Euro (positiv).
     * null entfernt bestehende Rabattzeilen. Der Festpreis bleibt der Endbetrag.
     */
    discount?: { label?: string | null; amount?: string | number | null; description?: string | null } | null;
  }
) {
  // Nach der Kundenannahme ist das Angebot eingefroren (erst „Annahme aufheben“).
  await pruefeNichtAngenommen(dealRecordId);

  // Lesen, Vergleichen und Schreiben (Kopf und Posten) in einer Transaktion unter der
  // Sperre des Angebots, die auch das Sperren einer Kalkulationsversion nimmt. Sonst
  // vergleicht ein Speichern mit einem alten Stand, schreibt dessen Preis und lässt
  // die Verknüpfung zu einer inzwischen gesperrten Version stehen.
  await db.transaction(async (tx) => {
    await angebotSperren(tx, dealRecordId);
    const [row] = await tx
      .select()
      .from(quotations)
      .where(eq(quotations.dealRecordId, dealRecordId))
      .limit(1)
      .for("update");
    const existing = row
      ? {
          ...row,
          lineItems: await tx
            .select()
            .from(quotationLineItems)
            .where(eq(quotationLineItems.quotationId, row.id))
            .orderBy(quotationLineItems.sortOrder),
        }
      : null;

    // Posten vorab normalisieren: ungültige Posten scheitern vor jedem Schreiben,
    // und der Vergleich mit dem gespeicherten Stand sieht dieselben Zeilen, die
    // geschrieben werden.
    const discountProvided = input.discount !== undefined;
    const linesProvided = input.lineItems !== undefined;
    let next: StoredLine[] | null = null;
    if (linesProvided || discountProvided) {
      const source: unknown[] = linesProvided
        ? input.lineItems ?? []
        : (existing?.lineItems ?? []).map((li) => ({
            type: li.type,
            description: li.description,
            quantity: li.quantity,
            unitRate: li.unitRate,
            sortOrder: li.sortOrder,
          }));
      const normalized = source.map((li, index) => normalizeLineItem(li, index));
      next = discountProvided
        ? applyDiscountToLines({
            fixedPrice: input.fixedPrice ?? null,
            lineItems: normalized,
            discount: parseDiscount(input.discount),
          })
        : normalized;
    }

    let quotationId: string;

    if (existing) {
      // Handänderung an Preis oder Posten löst die Verknüpfung zur Kalkulationsversion;
      // reine Kundenfelder (Notizen, Beschreibung, Gültigkeit, Anzahlung) lassen sie stehen.
      const preisGeaendert = angebotGeaendert(existing, {
        fixedPrice: input.fixedPrice ?? null,
        isVariable: input.isVariable,
        lineItems: next ?? existing.lineItems,
      });
      const [updated] = await tx
        .update(quotations)
        .set({
          ...(preisGeaendert ? { calculationVersionId: null } : {}),
          fixedPrice: input.fixedPrice ?? null,
          isVariable: input.isVariable,
          notes: input.notes ?? null,
          depositRequiredCents:
            input.depositRequiredCents !== undefined
              ? input.depositRequiredCents
              : existing.depositRequiredCents,
          paymentMethodPreference:
            input.paymentMethodPreference !== undefined
              ? input.paymentMethodPreference
              : existing.paymentMethodPreference,
          validUntil:
            input.validUntil !== undefined ? input.validUntil : existing.validUntil,
          summary:
            input.summary !== undefined ? input.summary : existing.summary,
          showStandardInclusions:
            input.showStandardInclusions !== undefined
              ? input.showStandardInclusions
              : existing.showStandardInclusions,
          selectedPackageSlug:
            input.selectedPackageSlug !== undefined
              ? input.selectedPackageSlug
              : existing.selectedPackageSlug,
          // Interne Felder (Selbstkosten, Marge, Übernahme) bleiben erhalten, wenn nur Kundenfelder kommen.
          calculationAssumptions:
            input.calculationAssumptions !== undefined
              ? annahmenZusammenfuehren(existing.calculationAssumptions, input.calculationAssumptions)
              : existing.calculationAssumptions,
          documentDetails:
            input.documentDetails !== undefined
              ? input.documentDetails === null
                ? null
                : { ...((existing.documentDetails ?? {}) as QuotationDocumentDetails), ...input.documentDetails }
              : existing.documentDetails,
          updatedAt: new Date(),
        })
        .where(eq(quotations.id, existing.id))
        .returning();
      quotationId = updated.id;
    } else {
      const [created] = await tx
        .insert(quotations)
        .values({
          dealRecordId,
          fixedPrice: input.fixedPrice ?? null,
          isVariable: input.isVariable,
          notes: input.notes ?? null,
          depositRequiredCents: input.depositRequiredCents ?? null,
          paymentMethodPreference: input.paymentMethodPreference ?? null,
          validUntil: input.validUntil ?? null,
          summary: input.summary ?? null,
          showStandardInclusions: input.showStandardInclusions ?? true,
          selectedPackageSlug: input.selectedPackageSlug ?? null,
          calculationAssumptions: input.calculationAssumptions ?? null,
          documentDetails: input.documentDetails ?? null,
        })
        .returning();
      quotationId = created.id;
    }

    if (next) {
      await tx.delete(quotationLineItems).where(eq(quotationLineItems.quotationId, quotationId));
      if (next.length > 0) {
        await tx.insert(quotationLineItems).values(
          next.map((li) => ({
            quotationId,
            type: li.type,
            description: li.description,
            quantity: li.quantity,
            unitRate: li.unitRate,
            sortOrder: li.sortOrder,
          }))
        );
      }
    }
  });

  return getQuotation(dealRecordId);
}

export async function getProfitSummary(dealRecordId: string) {
  const quotation = await getQuotation(dealRecordId);
  if (!quotation) return null;

  let revenue = 0;
  if (quotation.isVariable && quotation.lineItems.length > 0) {
    revenue = quotation.lineItems.reduce(
      (sum, li) => sum + li.quantity * Number(li.unitRate),
      0
    );
  } else if (quotation.fixedPrice) {
    revenue = Number(quotation.fixedPrice);
  }

  const assignments = await db
    .select({
      role: dealEmployees.role,
      hourlyRate: employees.hourlyRate,
      employeeName: employees.name,
    })
    .from(dealEmployees)
    .innerJoin(employees, eq(employees.id, dealEmployees.employeeId))
    .where(eq(dealEmployees.dealRecordId, dealRecordId));

  const helperLineItems = quotation.lineItems.filter((li) => li.type === "helper");
  const totalHelperHours = helperLineItems.reduce((sum, li) => sum + li.quantity, 0);
  const avgHoursPerHelper = assignments.length > 0 ? totalHelperHours / assignments.length : 0;

  const employeeExpenses = assignments.map((a) => ({
    name: a.employeeName,
    hourlyRate: Number(a.hourlyRate),
    estimatedHours: avgHoursPerHelper,
    cost: Number(a.hourlyRate) * avgHoursPerHelper,
  }));

  const totalExpenses = employeeExpenses.reduce((sum, e) => sum + e.cost, 0);
  const profit = revenue - totalExpenses;

  return {
    revenue,
    expenses: { employees: employeeExpenses, total: totalExpenses },
    profit,
  };
}

/**
 * Schreibt die Quotation des Deals aus einer gesperrten Kalkulationsversion,
 * innerhalb der Transaktion des Sperrens (`tx`). Festpreis = Summe der Posten
 * auf den Cent; Posten genau wie geliefert (auch 0-€-Zeilen), Menge ganzzahlig.
 * Notizen, Beschreibung, Anzahlung, Zahlungsart und gewähltes Paket bleiben.
 * Prüft die Kundenannahme nicht selbst: das tut `sperrenUndAngebot` in derselben
 * Transaktion, nachdem es `angebotSperren` genommen hat.
 */
export async function angebotAusVersionSchreiben(
  tx: DbExecutor,
  dealRecordId: string,
  eingabe: AngebotsEingabe,
  calculationVersionId: string
): Promise<void> {
  const posten = eingabe.lineItems.map((li, i) => {
    const quantity = Number(li.quantity);
    const rate = Number(li.unitRate);
    if (!Number.isInteger(quantity)) throw new Error(`Posten ${i + 1}: Menge muss ganzzahlig sein.`);
    if (!Number.isFinite(rate)) throw new Error(`Posten ${i + 1}: Einzelpreis ist keine Zahl.`);
    return { description: li.description, quantity, unitRate: rate.toFixed(2), sortOrder: li.sortOrder ?? i, cent: Math.round(rate * 100) };
  });
  const fixedPrice = (posten.reduce((s, p) => s + p.cent * p.quantity, 0) / 100).toFixed(2);

  const [existing] = await tx.select().from(quotations).where(eq(quotations.dealRecordId, dealRecordId)).limit(1);
  let quotationId: string;
  if (existing) {
    await tx
      .update(quotations)
      .set({
        fixedPrice,
        isVariable: false,
        validUntil: eingabe.validUntil,
        calculationAssumptions: annahmenZusammenfuehren(existing.calculationAssumptions, eingabe.calculationAssumptions),
        documentDetails: { ...((existing.documentDetails ?? {}) as QuotationDocumentDetails), ...eingabe.documentDetails },
        calculationVersionId,
        updatedAt: new Date(),
      })
      .where(eq(quotations.id, existing.id));
    quotationId = existing.id;
  } else {
    const [created] = await tx
      .insert(quotations)
      .values({
        dealRecordId,
        fixedPrice,
        isVariable: false,
        notes: eingabe.notes ?? null,
        validUntil: eingabe.validUntil,
        calculationAssumptions: eingabe.calculationAssumptions,
        documentDetails: eingabe.documentDetails,
        calculationVersionId,
      })
      .returning({ id: quotations.id });
    quotationId = created.id;
  }

  await tx.delete(quotationLineItems).where(eq(quotationLineItems.quotationId, quotationId));
  if (posten.length > 0) {
    await tx.insert(quotationLineItems).values(
      posten.map((p) => ({
        quotationId,
        type: "other" as const,
        description: p.description,
        quantity: p.quantity,
        unitRate: p.unitRate,
        sortOrder: p.sortOrder,
      }))
    );
  }
}
