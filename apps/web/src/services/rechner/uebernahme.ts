/**
 * Übernahme einer Kalkulation ins Angebot ("In Angebot übernehmen"). Reine
 * Funktion: baut die Eingabe für upsertQuotation. Seit 2026-09-29 schreibt sie
 * auch die Posten (Kern + Hebel, Summe = Festpreis), die Leistungen für den KV
 * und die Gültigkeit: vorher stand im KV nur "Pauschale" und als Leistung nur
 * der Transport, auch wenn Halteverbot und Montage eingerechnet waren.
 * Vorhandene Notizen werden ausdrücklich weitergegeben, weil upsertQuotation
 * fehlende Notizen sonst leert.
 */
import type { CalculationAssumptions, QuotationDocumentDetails } from "@/db/schema/quotations";
import type { RechnerErgebnis } from "./client";
import type { RechnerAnfrage } from "./eingabe";
import { kvBausteine, kvGueltigBis, type KvOptionen } from "./kv-posten";
import { MARGE_MAX_PROZENT, MARGE_MIN_PROZENT, preisBeiMarge } from "./marge";
import { heuteBerlin } from "./quelle";

const AUFZUG_TEXT: Record<string, string> = { keiner: "ohne Aufzug", klein: "kleiner Aufzug", gross: "großer Aufzug" };

export type UebernahmeErgebnis =
  | {
      ok: true;
      eingabe: {
        fixedPrice: string;
        isVariable: false;
        notes: string | null;
        calculationAssumptions: CalculationAssumptions;
        lineItems: Array<{ type: "other"; description: string; quantity: number; unitRate: string; sortOrder: number }>;
        documentDetails: QuotationDocumentDetails;
        /** YYYY-MM-DD */
        validUntil: string;
      };
      /** Hinweis zur Gültigkeit (Umzug bald, Datum vorbei), sonst null */
      gueltigkeitHinweis: string | null;
      /** Möbel, die laut Kalkulation zerlegt werden, und wer das macht */
      montage: { moebel: string[]; durchUns: boolean };
    }
  | { ok: false; fehler: string };

function text(anfrage: RechnerAnfrage, feld: string): string | null {
  const wert = anfrage[feld];
  return typeof wert === "string" && wert !== "" ? wert : null;
}

export function angebotsUebernahme(
  kalkulation: { result: RechnerErgebnis | null; request: RechnerAnfrage } | null,
  vorhandenesAngebot: { notes: string | null; isVariable: boolean; validUntil?: string | null } | null,
  opts: {
    bestaetigtSpanne?: boolean;
    margeProzent?: number | null;
    uebernommenVon?: "mensch" | "agent";
    jetzt?: Date;
    /** Vom Inhaber vorgegebener Endpreis (KV-Freigabe per WhatsApp), ersetzt Rechner- und Margenpreis */
    endpreis?: number | null;
    /** Hebel weglassen (KV-Freigabe "ohne montage" / "ohne halteverbot") */
    optionen?: KvOptionen;
  }
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

  const endpreis = opts.endpreis ?? null;
  if (endpreis !== null && (!Number.isFinite(endpreis) || endpreis <= 0)) return { ok: false, fehler: "Ungültiger Preis." };
  const kv = kvBausteine({
    festpreis: endpreis ?? preis,
    ergebnis,
    anfrage: kalkulation.request,
    optionen: opts.optionen,
    festpreisIstEndpreis: endpreis !== null,
  });
  // Nie unter der Mindestmarge, auch nicht mit Vorgabe oder "ohne …": gemessen an den
  // Selbstkosten ohne die weggelassenen Leistungen (nicht am gesenkten Verkaufspreis).
  if (
    selbstkosten != null &&
    selbstkosten > 0 &&
    p?.rundungEur != null &&
    kv.summe < preisBeiMarge(Math.max(0, selbstkosten - kv.entfalleneKosten), MARGE_MIN_PROZENT, p.rundungEur)
  ) {
    return { ok: false, fehler: `Preis liegt unter der Mindestmarge von ${MARGE_MIN_PROZENT} %.` };
  }
  if (!(kv.summe > 0)) return { ok: false, fehler: "Ungültiger Preis." };
  preis = kv.summe;
  const jetzt = opts.jetzt ?? new Date();
  const heute = heuteBerlin(jetzt);
  // Eine noch gültige Frist bleibt (z. B. von Hand verlängert); neu nur ohne oder nach Ablauf.
  const vorhandeneFrist = vorhandenesAngebot?.validUntil ?? null;
  const gueltig =
    vorhandeneFrist && vorhandeneFrist >= heute
      ? { datum: vorhandeneFrist, hinweis: null }
      : kvGueltigBis(heute, kalkulation.request.umzugsdatum);

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
    gueltigkeitHinweis: gueltig.hinweis,
    montage: { moebel: kv.montageMoebel, durchUns: kv.montageDurchUns },
    eingabe: {
      fixedPrice: String(preis),
      lineItems: kv.posten.map((p, i) => ({
        type: "other" as const,
        description: p.description,
        quantity: p.quantity,
        unitRate: p.unitRate.toFixed(2),
        sortOrder: i,
      })),
      // Ohne serviceType: die Auftragsart steuert quotations.service_type (Küche bleibt Küche).
      documentDetails: { services: kv.leistungen, validUntil: gueltig.datum },
      validUntil: gueltig.datum,
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
        uebernommenAm: jetzt.toISOString(),
      },
    },
  };
}
