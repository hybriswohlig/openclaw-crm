/**
 * Offener Rest aus einer Quelle. Seit Plan 9 eine dünne Hülle um `offenAus`
 * (lib/geld.ts) für Aufrufer ohne Rechnungsdatensatz: Stunden-KV ohne Rest,
 * sonst aktive Annahme, sonst Festpreis. Kein Angebot ergibt keinen Betrag.
 * Bezahlt zählt wie preisZahlungenCent (ohne nicht_steuerbar), Gegenbuchungen negativ.
 */
import { offenAus } from "./geld";

export function restAus(e: {
  annahmeCent: number | null;
  festpreis: string | null;
  istStunden: boolean;
  zahlungen: { amount: string; taxTreatment: string | null }[];
}): {
  gesamtCent: number | null;
  bezahltCent: number;
  restCent: number | null;
  quelle: "annahme" | "angebot" | "stunden" | "keins";
} {
  const o = offenAus({ rechnung: null, ...e });
  return { ...o, quelle: o.quelle === "rechnung" ? "annahme" : o.quelle };
}
