/**
 * Wertregel der Lagekarte. Geld ist intern immer ganze Cent; Euro-Spalten
 * (quotations.fixed_price, quotation_line_items.unit_rate, payments.amount,
 * deals.value.amount, Rechner result.preis.festpreis) werden nur hier
 * umgerechnet. Unbekannt ist null, nie 0.
 */
import { pickDefaultDealOption } from "@openclaw-crm/customer-portal-core";
import type { LeadWert } from "@/lib/lagekarte/typen";

/** Euro (String oder Zahl) in ganze Cent. null bei leer oder nicht numerisch. */
export function euroZuCent(v: string | number | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "string" && v.trim() === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}

export interface AngebotRoh {
  fixedPriceEuro: string | null;
  isVariable: boolean;
  selectedPackageOptionId: string | null;
  optionen: Array<{ id: string; priceCents: number; isRecommended: boolean; sortOrder: number }>;
  positionen: Array<{ quantity: number; unitRateEuro: string }>;
}

/**
 * Angebotssumme in Cent, identisch zur Portal-Regel in
 * services/customer-portal-data.ts (gebundene Option, variable Positionen,
 * Festpreis). 0 oder unbekannt ergibt null.
 */
export function angebotSummeCent(a: AngebotRoh): number | null {
  const optionen = [...a.optionen].sort((x, y) => x.sortOrder - y.sortOrder);
  const gebunden = pickDefaultDealOption(optionen, a.selectedPackageOptionId);

  let cent: number | null = null;
  if (gebunden && !a.isVariable) {
    cent = gebunden.priceCents;
  } else if (a.isVariable && a.positionen.length > 0) {
    // Portal: toCents(roundCents(unit * qty)) je Position
    cent = a.positionen.reduce((s, p) => {
      const zeile = Math.round(Number(p.unitRateEuro) * p.quantity * 100) / 100;
      return s + Math.round(zeile * 100);
    }, 0);
  } else if (a.fixedPriceEuro) {
    cent = euroZuCent(a.fixedPriceEuro);
  }
  return cent !== null && Number.isFinite(cent) && cent > 0 ? cent : null;
}

/** Zahl > 0 aus Zahl oder numerischem String, sonst null (Euro, noch nicht umgerechnet). */
function positiveEuro(v: unknown): number | null {
  if (typeof v !== "number" && typeof v !== "string") return null;
  const cent = euroZuCent(v);
  return cent !== null && cent > 0 ? cent : null;
}

function alsObjekt(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

/**
 * Wert eines Leads: bestätigte Annahme, dann Angebot, dann deals.value,
 * dann Rechner-Festpreis. Nie 0.
 */
export function leadWert(e: {
  kvaCent: number | null;
  angebot: AngebotRoh | null;
  dealValue: unknown;
  rechnerErgebnis: unknown;
}): LeadWert | null {
  if (e.kvaCent !== null && e.kvaCent > 0) return { cent: e.kvaCent, art: "bestaetigt" };

  if (e.angebot) {
    const cent = angebotSummeCent(e.angebot);
    if (cent !== null) return { cent, art: "angebot" };
  }

  const dealCent = positiveEuro(alsObjekt(e.dealValue)?.amount);
  if (dealCent !== null) return { cent: dealCent, art: "schaetzung" };

  const festpreis = alsObjekt(alsObjekt(e.rechnerErgebnis)?.preis)?.festpreis;
  const rechnerCent = positiveEuro(festpreis);
  if (rechnerCent !== null) return { cent: rechnerCent, art: "schaetzung" };

  return null;
}

/** Bereits bezahlt in Cent, ohne Kaution (nicht_steuerbar). */
export function bezahltCent(zahlungen: Array<{ amountEuro: string | null; taxTreatment: string | null }>): number {
  return zahlungen.reduce((s, z) => (z.taxTreatment === "nicht_steuerbar" ? s : s + (euroZuCent(z.amountEuro) ?? 0)), 0);
}
