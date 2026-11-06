/**
 * Eine Zahlungsart für alle Schreibwege. Deutsche Altwerte (bar, Überweisung,
 * Karte) werden beim Schreiben auf die Aufzählung gelegt.
 */

export const ZAHLUNGSARTEN = ["bank_transfer", "paypal", "cash", "card", "other"] as const;
export type Zahlungsart = (typeof ZAHLUNGSARTEN)[number];

export const ZAHLUNGSART_LABEL: Record<Zahlungsart, string> = {
  bank_transfer: "Überweisung",
  paypal: "PayPal",
  cash: "Bar",
  card: "Karte",
  other: "Sonstiges",
};

export const ZAHLUNGSART_FEHLER =
  "Zahlungsart muss Überweisung, PayPal, Bar, Karte oder Sonstiges sein.";

const ALTWERTE: Record<string, Zahlungsart> = {
  bank_transfer: "bank_transfer",
  ueberweisung: "bank_transfer",
  überweisung: "bank_transfer",
  paypal: "paypal",
  cash: "cash",
  bar: "cash",
  card: "card",
  karte: "card",
  other: "other",
  sonstiges: "other",
};

/** null oder leer → null. Bekannte Werte und Altwerte → Aufzählung. Sonst "ungueltig". */
export function zahlungsartAus(eingabe: unknown): Zahlungsart | null | "ungueltig" {
  if (eingabe == null) return null;
  if (typeof eingabe !== "string") return "ungueltig";
  const roh = eingabe.trim().toLowerCase();
  if (roh === "") return null;
  return ALTWERTE[roh] ?? "ungueltig";
}

/** Label der Aufzählung, sonst der Rohwert. Leer wird „keine Angabe“. */
export function zahlungsartText(roh: string | null): string {
  if (roh == null || roh.trim() === "") return "keine Angabe";
  const art = zahlungsartAus(roh);
  if (art && art !== "ungueltig") return ZAHLUNGSART_LABEL[art];
  return roh;
}
