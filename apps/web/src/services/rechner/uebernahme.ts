/**
 * Übernahme einer Kalkulation ins Angebot ("In Angebot übernehmen"). Reine
 * Funktion: baut die Eingabe für upsertQuotation. Positionen (lineItems)
 * bleiben unangetastet; vorhandene Notizen werden ausdrücklich weitergegeben,
 * weil upsertQuotation fehlende Notizen sonst leert.
 */
import type { CalculationAssumptions } from "@/db/schema/quotations";
import type { RechnerErgebnis } from "./client";
import type { RechnerAnfrage } from "./eingabe";

const AUFZUG_TEXT: Record<string, string> = { keiner: "ohne Aufzug", klein: "kleiner Aufzug", gross: "großer Aufzug" };

export type UebernahmeErgebnis =
  | {
      ok: true;
      eingabe: {
        fixedPrice: string;
        isVariable: false;
        notes: string | null;
        calculationAssumptions: CalculationAssumptions;
      };
    }
  | { ok: false; fehler: string };

function text(anfrage: RechnerAnfrage, feld: string): string | null {
  const wert = anfrage[feld];
  return typeof wert === "string" && wert !== "" ? wert : null;
}

export function angebotsUebernahme(
  kalkulation: { result: RechnerErgebnis | null; request: RechnerAnfrage } | null,
  vorhandenesAngebot: { notes: string | null; isVariable: boolean } | null,
  opts: { bestaetigtSpanne?: boolean }
): UebernahmeErgebnis {
  const ergebnis = kalkulation?.result;
  if (!kalkulation || !ergebnis) return { ok: false, fehler: "Noch keine Kalkulation vorhanden." };

  const spanne = ergebnis.schaetzung ?? null;
  let preis: number | null;
  if (spanne) {
    if (!opts.bestaetigtSpanne) return { ok: false, fehler: "Nur eine Spanne vorhanden. Obergrenze übernehmen? (bestaetigtSpanne)" };
    preis = spanne.festpreisBis;
  } else {
    preis = ergebnis.preis?.festpreis ?? null;
  }
  if (preis === null) {
    const grund = ergebnis.preis?.nichtKalkulierbarGrund;
    return { ok: false, fehler: grund ? `Kein Preis kalkulierbar: ${grund}` : "Kein Preis kalkulierbar." };
  }

  const station = ergebnis.mietstation;
  const hinweisTeile = [
    station ? `Mietstation ${station.name} (Anfahrt ${Math.round(station.anfahrtMin)} Min, Rückfahrt ${Math.round(station.rueckfahrtMin)} Min).` : null,
    spanne ? `Schnellschätzung ${spanne.festpreisVon ?? "?"} bis ${spanne.festpreisBis ?? "?"} €, übernommen: Obergrenze.` : null,
    ...(spanne?.annahmen ?? []),
    ...(ergebnis.annahmen ?? []),
  ].filter((t): t is string => !!t);

  const aufzug = (feld: string) => {
    const wert = text(kalkulation.request, feld);
    return wert ? AUFZUG_TEXT[wert] ?? wert : null;
  };

  return {
    ok: true,
    eingabe: {
      fixedPrice: String(preis),
      isVariable: false,
      notes: vorhandenesAngebot?.notes ?? null,
      calculationAssumptions: {
        anfahrtMinuten: ergebnis.zeiten?.fahrtMin ?? null,
        anfahrtQuelle: station?.quelle === "google" ? "berechnet" : "manuell",
        etageVon: text(kalkulation.request, "von_etage"),
        etageBis: text(kalkulation.request, "nach_etage"),
        zugangVon: aufzug("von_aufzug"),
        zugangBis: aufzug("nach_aufzug"),
        inventarPositionen: (ergebnis.positionen ?? []).reduce((summe, p) => summe + p.menge, 0),
        inventarVolumenCbm: ergebnis.volumen?.nettoCbm ?? null,
        hinweis: hinweisTeile.join(" "),
      },
    },
  };
}
