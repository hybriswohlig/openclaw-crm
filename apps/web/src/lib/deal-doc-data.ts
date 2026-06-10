// apps/web/src/lib/deal-doc-data.ts
//
// Shared helpers for assembling the GenerateDocumentDialog payload from the
// Lead context returned by GET /api/v1/deals/[recordId]/auftrag. Used by the
// Auftrags-Tab on the deal page and the inbox context panel.
import type { DealData, Firma } from "@/components/GenerateDocumentDialog";

export interface LeadContext {
  name: string | null;
  move_date: string | null;
  move_from_address: unknown;
  move_to_address: unknown;
  floors_from: number | null;
  floors_to: number | null;
  elevator_from: string | null;
  elevator_to: string | null;
  inventory_notes: string | null;
  operating_company: { id: string; displayName: string } | null;
}

export function formatLocation(v: unknown): string {
  if (!v) return "—";
  if (typeof v === "string") return v;
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    return (
      [o.line1, o.postcode, o.city].filter(Boolean).join(", ") ||
      (typeof o.line1 === "string" ? o.line1 : "—")
    );
  }
  return "—";
}

export function buildDealDataForDocs(
  dealRecordId: string,
  ctx: LeadContext
): DealData | null {
  // Require the bare minimum the skill needs (firma + customer surname).
  if (!ctx.operating_company || !ctx.name) return null;
  const company = ctx.operating_company.displayName.toLowerCase();
  const firma: Firma = company.includes("ceylan") ? "ceylan" : "kottke";

  const nameParts = ctx.name.trim().split(/\s+/).filter(Boolean);
  if (nameParts.length === 0) return null;
  const nachname = nameParts[nameParts.length - 1];
  const vorname =
    nameParts.length > 1 ? nameParts.slice(0, -1).join(" ") : undefined;

  const besonderheiten = [
    ctx.floors_from != null &&
      `Auszug ${ctx.floors_from}. Stock${ctx.elevator_from ? ` (${ctx.elevator_from})` : ""}`,
    ctx.floors_to != null &&
      `Einzug ${ctx.floors_to}. Stock${ctx.elevator_to ? ` (${ctx.elevator_to})` : ""}`,
  ]
    .filter(Boolean)
    .join(", ") || undefined;

  const fromAddr = formatLocation(ctx.move_from_address);
  const toAddr = formatLocation(ctx.move_to_address);

  return {
    dealRecordId,
    firma,
    kunde: {
      vorname,
      nachname,
      adresse: fromAddr !== "—" ? fromAddr : undefined,
    },
    auftrag: {
      strecke_von: fromAddr !== "—" ? fromAddr : undefined,
      strecke_nach: toAddr !== "—" ? toAddr : undefined,
      datum: ctx.move_date ?? undefined,
      volumen: ctx.inventory_notes ?? undefined,
      besonderheiten,
    },
  };
}

/**
 * The pieces a Rechnung / Auftragsbestätigung needs before the dialog makes
 * sense. Returns German labels of everything that is still missing so the
 * panel can offer "manuell eingeben" vs. "KI-Analyse".
 */
export function missingDocFields(
  ctx: LeadContext | null,
  hasQuotation: boolean
): string[] {
  const missing: string[] = [];
  if (!ctx || !ctx.name) missing.push("Kundenname");
  if (!ctx?.operating_company) missing.push("Firma (Kottke/Ceylan)");
  if (!ctx?.move_date) missing.push("Umzugsdatum");
  if (!ctx || formatLocation(ctx.move_from_address) === "—")
    missing.push("Auszugsadresse");
  if (!ctx || formatLocation(ctx.move_to_address) === "—")
    missing.push("Einzugsadresse");
  if (!hasQuotation) missing.push("Kostenvoranschlag (Preis)");
  return missing;
}
