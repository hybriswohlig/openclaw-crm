/**
 * Steuerliche Klassifikation fuer Einnahmen und Ausgaben (Finanz Phase 2).
 *
 * Plain constants, importable from client AND server code (no db / server-only
 * imports). The DB enum (`expense_category`) carries the same values; this
 * file is the single source of truth for labels, display order and the
 * per-category default tax treatment.
 *
 * Beide Gesellschaften sind Kleinunternehmer (keine USt), daher gibt es hier
 * keine Brutto/Netto- oder USt-Satz-Logik.
 */

export type ExpenseTaxTreatment = "voll" | "teilweise" | "nicht";
export type IncomeTaxTreatment = "betriebseinnahme" | "nicht_steuerbar";

export const EXPENSE_TAX_TREATMENT_LABELS: Record<ExpenseTaxTreatment, string> = {
  voll: "Voll absetzbar",
  teilweise: "Teilweise absetzbar",
  nicht: "Nicht absetzbar",
};

export const INCOME_TAX_TREATMENT_LABELS: Record<IncomeTaxTreatment, string> = {
  betriebseinnahme: "Betriebseinnahme",
  nicht_steuerbar: "Nicht steuerbar",
};

export interface ExpenseCategoryDef {
  value: string;
  label: string;
  defaultTreatment: ExpenseTaxTreatment;
  /** Only set when defaultTreatment is "teilweise" (e.g. Bewirtung 70). */
  defaultPercent?: number;
  /** true = treatment is fixed by law and must not be changed in the UI. */
  locked?: boolean;
  hint?: string;
}

export const EXPENSE_CATEGORIES: ExpenseCategoryDef[] = [
  { value: "fuel", label: "Kraftstoff", defaultTreatment: "voll" },
  { value: "truck_rental", label: "LKW-Miete", defaultTreatment: "voll" },
  { value: "vehicle", label: "Fahrzeugkosten", defaultTreatment: "voll" },
  { value: "repairs", label: "Reparaturen", defaultTreatment: "voll" },
  { value: "equipment", label: "Ausstattung", defaultTreatment: "voll" },
  { value: "office", label: "Bürobedarf", defaultTreatment: "voll" },
  { value: "rent", label: "Miete", defaultTreatment: "voll" },
  { value: "insurance", label: "Versicherungen", defaultTreatment: "voll" },
  { value: "phone_internet", label: "Telefon/Internet", defaultTreatment: "voll" },
  { value: "advertising", label: "Werbung", defaultTreatment: "voll" },
  { value: "subcontractor", label: "Subunternehmer", defaultTreatment: "voll" },
  { value: "toll", label: "Maut", defaultTreatment: "voll" },
  { value: "tax_advisor", label: "Steuerberatung", defaultTreatment: "voll" },
  {
    value: "entertainment",
    label: "Bewirtung",
    defaultTreatment: "teilweise",
    defaultPercent: 70,
    hint: "Bewirtungskosten sind zu 70 Prozent absetzbar",
  },
  {
    value: "gifts",
    label: "Geschenke",
    defaultTreatment: "voll",
    hint: "Geschenke an Geschäftspartner nur bis 50 Euro pro Person und Jahr absetzbar",
  },
  {
    value: "fines",
    label: "Bußgelder",
    defaultTreatment: "nicht",
    locked: true,
    hint: "Buß- und Verwarngelder sind nie absetzbar",
  },
  { value: "other", label: "Sonstiges", defaultTreatment: "voll" },
];
