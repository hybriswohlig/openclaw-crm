import type { RechnerErgebnis } from "@/services/rechner/client";
import { MARGE_MAX_PROZENT, MARGE_MIN_PROZENT, preisBeiMarge } from "@/services/rechner/marge";
import { euroText } from "./anzeige";

export interface ReglerGrund {
  text: string;
  punkte: number;
}

export interface ReglerZustand {
  verfuegbar: boolean;
  startMarge: number;
  /** Gewählte Marge (Reglerwert, auf 30 bis 60 geklemmt), null ohne Regler. */
  margeGewaehlt: number | null;
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
    margeGewaehlt: null,
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
    margeGewaehlt: m,
    veraltet: false,
    festpreis,
    festpreisVon,
    margeEur,
    margeProzent: Math.round((margeEur / festpreis) * 1000) / 10,
    listenpreis: p.listenpreis ?? null,
    gruende: p.margeVorschlag.gruende,
  };
}

/** Prozentwert deutsch: Dezimalkomma, höchstens eine Nachkommastelle. */
export function prozentText(x: number): string {
  return `${x.toLocaleString("de-DE", { maximumFractionDigits: 1 })} %`;
}

/** Punkte eines Grunds mit Vorzeichen (Minus als U+2212), deutsch formatiert. */
export function punkteText(punkte: number): string {
  const betrag = Math.abs(punkte).toLocaleString("de-DE", { maximumFractionDigits: 1 });
  return punkte > 0 ? `+${betrag}` : punkte < 0 ? `\u2212${betrag}` : "0";
}

export interface ReglerTexte {
  /** Reglerpreis wie die Überschrift der Karte: "1.080 €" oder "690 € bis 1.000 €". */
  preis: string;
  /** "Marge 35 % (Vorschlag 40 %)" */
  marge: string;
  /** "380 € Marge, nach Rundung 35,2 %" */
  margeDetail: string;
  /** aria-valuetext des Reglers: "35 % Marge" */
  aria: string;
}

/** Texte der Karte bei verfügbarem Regler; null, wenn es keinen Regler gibt (dann bleibt die Karte wie bisher). */
export function reglerTexte(z: ReglerZustand): ReglerTexte | null {
  if (!z.verfuegbar || z.festpreis == null || z.margeGewaehlt == null) return null;
  const preis = z.festpreisVon != null && z.festpreisVon !== z.festpreis
    ? `${euroText(z.festpreisVon)} bis ${euroText(z.festpreis)}`
    : euroText(z.festpreis);
  return {
    preis,
    marge: `Marge ${prozentText(z.margeGewaehlt)} (Vorschlag ${prozentText(z.startMarge)})`,
    margeDetail: `${euroText(z.margeEur ?? 0)} Marge, nach Rundung ${prozentText(z.margeProzent ?? 0)}`,
    aria: `${prozentText(z.margeGewaehlt)} Marge`,
  };
}
