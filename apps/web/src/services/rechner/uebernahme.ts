/**
 * Übernahme einer Kalkulation ins Angebot ("In Angebot übernehmen"). Reine
 * Funktion: baut die Eingabe für upsertQuotation. Positionen (lineItems)
 * bleiben unangetastet; vorhandene Notizen werden ausdrücklich weitergegeben,
 * weil upsertQuotation fehlende Notizen sonst leert.
 */
import type { CalculationAssumptions } from "@/db/schema/quotations";
import type { RechnerErgebnis } from "./client";
import type { RechnerAnfrage } from "./eingabe";
import { MARGE_MAX_PROZENT, MARGE_MIN_PROZENT, preisBeiMarge } from "./marge";

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
  opts: { bestaetigtSpanne?: boolean; margeProzent?: number | null; uebernommenVon?: "mensch" | "agent"; jetzt?: Date }
): UebernahmeErgebnis {
  const ergebnis = kalkulation?.result;
  if (!kalkulation || !ergebnis) return { ok: false, fehler: "Noch keine Kalkulation vorhanden." };

  const m = opts.margeProzent ?? null;
  if (m !== null && (!Number.isFinite(m) || m < MARGE_MIN_PROZENT || m > MARGE_MAX_PROZENT)) {
    return { ok: false, fehler: `Marge muss zwischen ${MARGE_MIN_PROZENT} und ${MARGE_MAX_PROZENT} % liegen.` };
  }
  const p = ergebnis.preis;
  const spanne = ergebnis.schaetzung ?? null;
  if (spanne && !opts.bestaetigtSpanne) return { ok: false, fehler: "Nur eine Spanne vorhanden. Obergrenze übernehmen? (bestaetigtSpanne)" };

  // Zuerst der Basispreis des Rechners: ohne ihn gibt es nichts zu übernehmen, auch nicht mit Marge.
  const basisPreis = spanne ? spanne.festpreisBis : p?.festpreis ?? null;
  if (basisPreis === null || basisPreis === undefined) {
    const grund = p?.nichtKalkulierbarGrund;
    return { ok: false, fehler: grund ? `Kein Preis kalkulierbar: ${grund}` : "Kein Preis kalkulierbar." };
  }

  let preis: number = basisPreis;
  let selbstkosten: number | null = spanne?.selbstkostenBis ?? p?.selbstkosten ?? ergebnis.kosten?.selbstkosten ?? null;
  let spanneVon: number | null = spanne?.festpreisVon ?? null;
  if (m !== null) {
    if (p?.rundungEur == null || (spanne ? spanne.selbstkostenBis == null : p.selbstkosten == null)) {
      return { ok: false, fehler: "Kalkulation veraltet, bitte neu rechnen." };
    }
    selbstkosten = spanne ? spanne.selbstkostenBis! : p.selbstkosten!;
    preis = preisBeiMarge(selbstkosten, m, p.rundungEur);
    if (spanne && spanne.selbstkostenVon != null) spanneVon = preisBeiMarge(spanne.selbstkostenVon, m, p.rundungEur);
  } else if (selbstkosten != null && selbstkosten > 0 && p?.rundungEur != null && preis < preisBeiMarge(selbstkosten, MARGE_MIN_PROZENT, p.rundungEur)) {
    return { ok: false, fehler: `Preis liegt unter der Mindestmarge von ${MARGE_MIN_PROZENT} %, bitte neu rechnen.` };
  }
  const margeGewaehlt = m ?? (spanne ? spanne.margeProzent ?? null : null) ?? p?.margeWirksamProzent ?? null;

  const station = ergebnis.mietstation;
  const hinweisTeile = [
    station ? `Mietstation ${station.name} (Anfahrt ${Math.round(station.anfahrtMin)} Min, Rückfahrt ${Math.round(station.rueckfahrtMin)} Min).` : null,
    spanne ? `Schnellschätzung ${spanneVon ?? "?"} bis ${preis} €, übernommen: Obergrenze.` : null,
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
        selbstkosten,
        margeVorschlagProzent: p?.margeVorschlag?.prozent ?? null,
        margeGruende: p?.margeVorschlag?.gruende ?? null,
        margeGewaehltProzent: margeGewaehlt,
        margeTatsaechlichProzent: preis && selbstkosten != null ? Math.round(((preis - selbstkosten) / preis) * 1000) / 10 : null,
        uebernommenVon: opts.uebernommenVon ?? "mensch",
        uebernommenAm: (opts.jetzt ?? new Date()).toISOString(),
      },
    },
  };
}
