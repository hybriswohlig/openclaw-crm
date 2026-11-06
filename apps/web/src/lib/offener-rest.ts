/**
 * Offener Rest aus einer Quelle. Ein Stunden-KV hat keinen Rest, auch wenn
 * eine Annahme gesetzt ist (deren Summe ist nur eine Schätzung). Sonst
 * aktive Annahme, sonst Festpreis. Kein Angebot ergibt keinen Betrag.
 * Bezahlt zählt wie preisZahlungenCent (ohne nicht_steuerbar).
 */
import { preisZahlungenCent } from "./preis-zahlungen";

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
  const bezahltCent = preisZahlungenCent(e.zahlungen);
  if (e.istStunden) {
    return { gesamtCent: null, bezahltCent, restCent: null, quelle: "stunden" };
  }
  if (e.annahmeCent != null) {
    return {
      gesamtCent: e.annahmeCent,
      bezahltCent,
      restCent: Math.max(0, e.annahmeCent - bezahltCent),
      quelle: "annahme",
    };
  }
  const gesamtCent = euroNachCent(e.festpreis);
  if (gesamtCent == null) {
    return { gesamtCent: null, bezahltCent, restCent: null, quelle: "keins" };
  }
  return {
    gesamtCent,
    bezahltCent,
    restCent: Math.max(0, gesamtCent - bezahltCent),
    quelle: "angebot",
  };
}

function euroNachCent(festpreis: string | null): number | null {
  if (festpreis == null) return null;
  const text = festpreis.trim();
  if (text === "") return null;
  const euro = Number(text);
  if (!Number.isFinite(euro)) return null;
  return Math.round(euro * 100);
}
