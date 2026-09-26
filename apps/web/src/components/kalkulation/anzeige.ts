/**
 * Was die Karte "Kalkulation" zeigt, aus Status und gespeicherter Kalkulation.
 * Reine Funktion (ohne React), damit die Fälle testbar sind.
 */
import type { RechnerErgebnis } from "@/services/rechner/client";

export type KalkulationsStatus = "neu" | "unveraendert" | "gedrosselt" | "fehler";

export interface KalkulationJson {
  dealRecordId: string;
  workspaceId: string;
  inputHash: string;
  request: Record<string, unknown>;
  result: RechnerErgebnis | null;
  error: string | null;
  computedAt: string;
}

export interface KartenAnzeige {
  art: "festpreis" | "spanne" | "leer" | "fehler";
  preisText: string;
  spanne: boolean;
  kannUebernehmen: boolean;
  station: string | null;
  warnung: string | null;
  annahmen: string[];
}

export function euroText(betrag: number): string {
  return `${Math.round(betrag).toLocaleString("de-DE")} €`;
}

export function kartenAnzeige(status: KalkulationsStatus, k: KalkulationJson | null): KartenAnzeige {
  const e = k?.result ?? null;
  if (!e) {
    return {
      art: "fehler",
      preisText: "Kalkulation derzeit nicht verfügbar",
      spanne: false,
      kannUebernehmen: false,
      station: null,
      warnung: k?.error ?? (status === "fehler" ? "Der Angebotsrechner hat nicht geantwortet." : null),
      annahmen: [],
    };
  }

  const s = e.mietstation;
  const station = s
    ? `${s.name}, Anfahrt ${Math.round(s.anfahrtMin)} Min (${s.quelle === "google" ? "Google Maps" : "angenommen"})`
    : null;
  const hinweisTexte = (e.hinweise ?? []).map((h) => h.text);
  const fehlerText = k?.error ? `Letzte Neuberechnung fehlgeschlagen: ${k.error}` : null;
  const annahmen = [...(e.schaetzung?.annahmen ?? []), ...(e.annahmen ?? [])];

  const sp = e.schaetzung;
  if (sp && sp.festpreisVon !== null && sp.festpreisBis !== null) {
    return {
      art: "spanne",
      preisText: sp.festpreisVon === sp.festpreisBis ? euroText(sp.festpreisBis) : `${euroText(sp.festpreisVon)} bis ${euroText(sp.festpreisBis)}`,
      spanne: true,
      kannUebernehmen: true,
      station,
      warnung: fehlerText,
      annahmen,
    };
  }

  const preis = e.preis?.festpreis ?? null;
  if (preis === null) {
    const grund = e.preis?.nichtKalkulierbarGrund ?? null;
    return {
      art: "leer",
      preisText: "Noch kein Preis",
      spanne: false,
      kannUebernehmen: false,
      station,
      warnung: fehlerText ?? ([...hinweisTexte.filter((t) => /Wohnfläche|Zimmer|Möbel/.test(t)), grund].filter(Boolean).join(" ") || null),
      annahmen,
    };
  }

  return { art: "festpreis", preisText: euroText(preis), spanne: false, kannUebernehmen: true, station, warnung: fehlerText, annahmen };
}
