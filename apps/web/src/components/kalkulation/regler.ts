import type { RechnerErgebnis } from "@/services/rechner/client";
import { MARGE_MAX_PROZENT, MARGE_MIN_PROZENT, preisBeiMarge } from "@/services/rechner/marge";

export interface ReglerGrund {
  text: string;
  punkte: number;
}

export interface ReglerZustand {
  verfuegbar: boolean;
  startMarge: number;
  veraltet: boolean;
  festpreis: number | null;
  festpreisVon: number | null;
  margeEur: number | null;
  margeProzent: number | null;
  listenpreis: number | null;
  gruende: ReglerGrund[];
}

/**
 * Live-Preis des Margenreglers aus dem gespeicherten Rechner-Ergebnis.
 * Alte Ergebnisse ohne Vorschlag/Rundung (vor der Margen-Umstellung) sind "veraltet":
 * kein Regler, Start bei 30 %.
 */
export function reglerZustand(e: RechnerErgebnis | null, marge: number | null): ReglerZustand {
  const p = e?.preis;
  const leer = {
    festpreis: null,
    festpreisVon: null,
    margeEur: null,
    margeProzent: null,
    listenpreis: p?.listenpreis ?? null,
    gruende: p?.margeVorschlag?.gruende ?? [],
  };
  if (!e || !p || p.festpreis == null) return { verfuegbar: false, startMarge: MARGE_MIN_PROZENT, veraltet: false, ...leer };
  if (p.selbstkosten == null || p.rundungEur == null || !p.margeVorschlag) {
    return { verfuegbar: false, startMarge: MARGE_MIN_PROZENT, veraltet: true, ...leer };
  }
  const start = p.margeVorschlag.prozent;
  const m = Math.min(Math.max(marge ?? start, MARGE_MIN_PROZENT), MARGE_MAX_PROZENT);
  const s = e.schaetzung;
  const kostenBis = s?.selbstkostenBis ?? p.selbstkosten;
  const festpreis = preisBeiMarge(kostenBis, m, p.rundungEur);
  const festpreisVon = s?.selbstkostenVon != null ? preisBeiMarge(s.selbstkostenVon, m, p.rundungEur) : null;
  const margeEur = festpreis - kostenBis;
  return {
    verfuegbar: true,
    startMarge: start,
    veraltet: false,
    festpreis,
    festpreisVon,
    margeEur,
    margeProzent: Math.round((margeEur / festpreis) * 1000) / 10,
    listenpreis: p.listenpreis ?? null,
    gruende: p.margeVorschlag.gruende,
  };
}
