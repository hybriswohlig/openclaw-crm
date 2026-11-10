// apps/web/src/lib/deal-doc-data.ts
//
// Shared helpers for assembling the GenerateDocumentDialog payload from the
// Lead context returned by GET /api/v1/deals/[recordId]/auftrag. Used by the
// Auftrags-Tab on the deal page and the inbox context panel.
import type { DealData, Firma } from "@/components/GenerateDocumentDialog";

export interface LeadContext {
  /**
   * Deal / lead title. Often auto-generated with city/date decoration
   * (e.g. "Kyra Hiker — Freudenstadt → Stuttgart" or "Kyra Hiker Freudenstadt").
   * Prefer `person_name` for documents.
   */
  name: string | null;
  /**
   * Real customer name from the linked person (`associated_people`).
   * Used as the primary source for PDF kunde fields.
   */
  person_name: string | null;
  /** Structured parts from personal_name when available. */
  person_vorname: string | null;
  person_nachname: string | null;
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
  // Leere oder nur aus Leerzeichen bestehende Angaben zählen als fehlend: sonst ginge
  // `kunde.adresse: ""` an die Vorlage, die dann mit „Kundenanschrift fehlt“ abbricht.
  if (typeof v === "string") return v.trim() || "—";
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    const teil = (x: unknown) => (typeof x === "string" ? x.trim() : "");
    // Ohne Straße (Einzug nur mit PLZ und Ort, Inhaber 10.11.): „71032 Böblingen“ statt „71032, Böblingen“.
    if (!teil(o.line1)) return [teil(o.postcode), teil(o.city)].filter(Boolean).join(" ") || "—";
    return [teil(o.line1), teil(o.postcode), teil(o.city)].filter(Boolean).join(", ") || "—";
  }
  return "—";
}

/** „Hauptstr. 1, 72218, Wildberg“ → „Hauptstr. 1, 3. OG, 72218, Wildberg“, wenn ein Zusatz da ist. */
function mitZusatz(v: unknown, text: string): string {
  if (!v || typeof v !== "object" || text === "—") return text;
  const o = v as Record<string, unknown>;
  const line1 = typeof o.line1 === "string" ? o.line1.trim() : "";
  const line2 = typeof o.line2 === "string" ? o.line2.trim() : "";
  if (!line1 || !line2 || !text.startsWith(line1)) return text;
  return `${line1}, ${line2}${text.slice(line1.length)}`;
}

/**
 * Strip auto-generated lead-title decorations so a bare person name remains.
 * Handles computeLeadName formats:
 *   - "Name — FromCity → ToCity"
 *   - "Name — DD.MM.YYYY"
 * Also strips if the full string (or a wrongly-split vorname) still contains
 * the route arrow / em-dash (person records sometimes stored the lead title).
 * Does not try to guess bare trailing cities without a separator.
 */
export function stripLeadTitleDecorations(title: string | null | undefined): string | null {
  if (!title) return null;
  let t = title.trim();
  if (!t) return null;
  // Em-dash / en-dash / spaced hyphen separators used by computeLeadName
  t = t.split(/\s+[—–]\s+/)[0]?.trim() || t;
  t = t.split(/\s+-\s+/)[0]?.trim() || t;
  // If anything still has a route arrow, take the left side
  if (/\s+→\s+/.test(t)) {
    t = t.split(/\s+→\s+/)[0]?.trim() || t;
  }
  return t || null;
}

/**
 * True when a string still looks like an auto-generated lead title rather than
 * a real person name (city route or date decoration present).
 */
export function looksLikeDecoratedLeadTitle(s: string | null | undefined): boolean {
  if (!s) return false;
  return /\s+[—–]\s+/.test(s) || /\s+→\s+/.test(s) || /\s+-\s+\d{2}\.\d{2}\.\d{4}/.test(s);
}

/**
 * Resolve the customer name for PDF / Anweisung generation.
 * Priority: linked person (structured) → linked person full name → cleaned lead title.
 * Always sanitizes lead-title decorations, including when they leaked into the person.
 */
export function resolveCustomerNameForDocs(ctx: LeadContext): {
  vorname?: string;
  nachname: string;
} | null {
  const personVor = ctx.person_vorname?.trim() || null;
  const personNach = ctx.person_nachname?.trim() || null;
  const personFull = ctx.person_name?.trim() || null;

  // Prefer structured person parts, but re-sanitize if they look like a lead title
  // (e.g. vorname="Kyra Heiker — Weil der Stadt → Weil der", nachname="Stadt").
  if (personNach || personVor || personFull) {
    const combined =
      personFull ||
      [personVor, personNach].filter(Boolean).join(" ") ||
      "";
    if (combined && !looksLikeDecoratedLeadTitle(combined) && !looksLikeDecoratedLeadTitle(personVor)) {
      if (personNach && !looksLikeDecoratedLeadTitle(personNach)) {
        return {
          vorname: personVor || undefined,
          nachname: personNach,
        };
      }
      return splitFullName(combined);
    }
    const cleanedPerson = stripLeadTitleDecorations(combined);
    if (cleanedPerson) return splitFullName(cleanedPerson);
  }

  const cleaned = stripLeadTitleDecorations(ctx.name);
  if (cleaned) {
    return splitFullName(cleaned);
  }

  return null;
}

function splitFullName(full: string): { vorname?: string; nachname: string } {
  const sanitized = stripLeadTitleDecorations(full) || full.trim();
  const nameParts = sanitized.split(/\s+/).filter(Boolean);
  if (nameParts.length === 0) return { nachname: sanitized };
  const nachname = nameParts[nameParts.length - 1];
  const vorname =
    nameParts.length > 1 ? nameParts.slice(0, -1).join(" ") : undefined;
  return { vorname, nachname };
}

export function buildDealDataForDocs(
  dealRecordId: string,
  ctx: LeadContext
): DealData | null {
  // Require the bare minimum the skill needs (firma + customer surname).
  const kunde = resolveCustomerNameForDocs(ctx);
  if (!ctx.operating_company || !kunde) return null;
  const company = ctx.operating_company.displayName.toLowerCase();
  const firma: Firma = company.includes("ceylan") ? "ceylan" : "kottke";

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
  // Strecke mit Zusatz („3. OG“): ein Umzug im selben Haus zeigt so zwei verschiedene Zeilen
  // (die Sperre „VON = NACH“ vergleicht genau, was gedruckt wird).
  const vonStrecke = mitZusatz(ctx.move_from_address, fromAddr);
  const nachStrecke = mitZusatz(ctx.move_to_address, toAddr);

  return {
    dealRecordId,
    firma,
    kunde: {
      vorname: kunde.vorname,
      nachname: kunde.nachname,
      adresse: fromAddr !== "—" ? fromAddr : undefined,
    },
    auftrag: {
      strecke_von: fromAddr !== "—" ? vonStrecke : undefined,
      strecke_nach: toAddr !== "—" ? nachStrecke : undefined,
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
  hasQuotation: boolean,
  documentType?: "KV" | "AB" | "RE"
): string[] {
  const missing: string[] = [];
  if (!ctx || !resolveCustomerNameForDocs(ctx)) missing.push("Kundenname");
  if (!ctx?.operating_company) missing.push("Firma (Kottke/Ceylan)");
  if (!ctx?.move_date) missing.push("Umzugsdatum");
  if (!ctx || formatLocation(ctx.move_from_address) === "—")
    missing.push("Auszugsadresse");
  if (!ctx || formatLocation(ctx.move_to_address) === "—")
    missing.push("Einzugsadresse");
  // KV is the quote PDF. Requiring a stored quotation first is circular.
  if (documentType !== "KV" && !hasQuotation) missing.push("Kostenvoranschlag (Preis)");
  return missing;
}
