/**
 * Reine Logik der Kalkulationsseite für Plan 5b (Task U1): Paketpreis- und
 * Preismodus-Anpassung, Kern-Warnung, Stunden-Ansicht, Sperren mit
 * Preis-Hash und Rückfrage beim Moduswechsel, Knopf „Tagespreise im
 * Termin-Dialog“. Ohne React, ohne Server-Importe. Keine Gedankenstriche.
 */
import { PLAN5_FEHLER_TEXT, type KernBefund, type PreisModus } from "@/lib/angebot-wahl";
import { euroText } from "@/lib/anzeige";
import type { KalkulationsAnsicht, PaketAnsicht, StundenAnsicht } from "@/lib/kalkulations-ansicht";
import { PAKET_HEBEL_LABEL } from "@/lib/paket-hebel";
import type { HebelArt } from "@/services/rechner/kv-posten";
import type { ApiAntwort } from "@/components/neu/akte/api";

/** Womit der Preis-Dialog öffnet (Paketpreis, Preismodus oder KV-Darstellung). */
export type PreisStart =
  | { art: "paketpreis"; slug?: string; betrag?: number }
  | { art: "preismodus"; modus?: PreisModus }
  | { art: "kv_darstellung"; wert?: "ein_posten" | "posten" };

export type PreisArt = PreisStart["art"];

/** Anpassung eines Tagespreises: geändert wird im Termin-Dialog. */
export type TerminStart = { art: "termin" };

/** Event des Termin-Dialogs: eine Definition in `termin-logik.ts` (Task U2). */
export {
  TERMIN_DIALOG_EVENT,
  terminDialogOeffnen,
  type TerminDialogEvent as TerminDialogDetail,
} from "@/components/neu/termin/termin-logik";

const ZAHL = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 2 });

/** „18,5“ → 18.5; leer oder Unsinn → null. Tausenderpunkte („1.890“) sind erlaubt. */
export function zahlAus(text: string): number | null {
  const roh = text.trim().replace(/\s|€/g, "");
  if (roh === "") return null;
  // „1.890,50“ und „1.890“: Punkte sind Tausender; „1890.5“ ohne Komma bleibt Dezimalpunkt, wenn hinten 1 oder 2 Stellen stehen.
  const ohneTausender = /,/.test(roh) || /\.\d{3}(\.|$)/.test(roh) ? roh.replace(/\./g, "") : roh;
  const n = Number(ohneTausender.replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

/** „1.890 €“ als Formularwert „1890“. */
export function betragText(betragEur: number | undefined): string {
  return betragEur === undefined ? "" : String(betragEur).replace(".", ",");
}

/**
 * Paketpreis-Anpassung vorab prüfen (Entscheidung 5b-4): Euro größer 0, auf
 * den Cent, nie unter dem Preis bei 30 % Marge (`untergrenzeCent`). Ohne
 * Untergrenze (Paket ohne Rechnerpreis, F7) prüft nur der Server.
 */
export function paketpreisPruefen(
  text: string,
  paket: Pick<PaketAnsicht, "untergrenzeCent"> | null
): { ok: true; wert: { betrag: number } } | { ok: false; meldung: string } {
  if (!paket) return { ok: false, meldung: "Bitte ein Paket wählen." };
  const n = zahlAus(text);
  if (n === null || n <= 0) return { ok: false, meldung: "Bitte einen Preis in Euro eingeben (größer 0)." };
  const cent = Math.round(n * 100);
  if (Math.abs(n * 100 - cent) > 1e-6) return { ok: false, meldung: "Bitte höchstens zwei Nachkommastellen." };
  const grenze = paket.untergrenzeCent ?? null;
  if (grenze !== null && cent < grenze) {
    return { ok: false, meldung: `Mindestens ${euroText(grenze)}: darunter läge die Marge unter 30 %.` };
  }
  return { ok: true, wert: { betrag: cent / 100 } };
}

export function hebelName(h: HebelArt): string {
  return PAKET_HEBEL_LABEL[h];
}

/** „Kern + Halteverbot, Montage“, „nur Kern“; null ohne Angabe. */
export function hebelText(hebel: readonly HebelArt[] | undefined): string | null {
  if (!hebel) return null;
  if (hebel.length === 0) return "nur Kern";
  return `Kern + ${hebel.map(hebelName).join(", ")}`;
}

export interface KernHinweis {
  ton: "gold" | "rose" | "blau";
  text: string;
  /** Welche KV-Darstellung der Knopf setzt; null = kein Knopf. */
  aktion: "ein_posten" | "posten" | null;
  knopf: string | null;
}

/**
 * Kern-Regel „kein Posten wird Pauschale“ (Entscheidung 5b-6, F13): nie
 * automatisch zusammenklappen. Kleiner Kern: Warnung mit „Als ein Posten
 * zeigen“ (Anpassung mit Grund). Kern ≤ 0: Text des Dienstes, kein Knopf.
 * Schon als ein Posten: Hinweis mit „Wieder einzeln zeigen“.
 */
export function kernHinweis(kern: KernBefund | null, darstellung: KalkulationsAnsicht["kvDarstellung"]): KernHinweis | null {
  if (darstellung === "ein_posten") {
    return {
      ton: "blau",
      text: "Der KV zeigt einen Posten mit Sammeltext. So angepasst, mit Grund.",
      aktion: "posten",
      knopf: "Wieder einzeln zeigen",
    };
  }
  if (!kern) return null;
  if (kern.art === "negativ") return { ton: "rose", text: PLAN5_FEHLER_TEXT.KERN_NEGATIV, aktion: null, knopf: null };
  if (kern.art === "klein") {
    const prozent = Math.round(kern.anteil * 100);
    return {
      ton: "gold",
      text: `Der erste Posten macht nur ${prozent} % des Preises aus. Die Posten bleiben trotzdem einzeln; zu einem Posten fasst sie nur ein Mensch mit Grund zusammen.`,
      aktion: "ein_posten",
      knopf: "Als ein Posten zeigen",
    };
  }
  return null;
}

/** „7,5 h“ */
export function stundenText(h: number): string {
  return `${ZAHL.format(h)} h`;
}

/** „35 €/h“ */
function satzText(eur: number): string {
  return `${ZAHL.format(eur)} €/h`;
}

export interface StundenZeile {
  label: string;
  wert: string;
  formel: string | null;
}

/** Zeilen der Stunden-Ansicht: Helfer, Transporter, Stunden, Mindeststunden, Zusatzposten. */
export function stundenZeilen(s: StundenAnsicht): StundenZeile[] {
  const zeilen: StundenZeile[] = [
    { label: s.helfer === 1 ? "1 Helfer" : `${s.helfer} Helfer`, wert: satzText(s.satzHelferEur), formel: "je Helfer und Stunde" },
    {
      label: s.transporter === 1 ? "1 Transporter" : `${s.transporter} Transporter`,
      wert: satzText(s.satzTransporterEur),
      formel: "je Transporter und Stunde",
    },
    { label: "Stunden geschätzt", wert: stundenText(s.stundenGeschaetzt), formel: "Personenstunden ÷ Team, auf halbe Stunden aufgerundet" },
    { label: "Mindeststunden", wert: stundenText(s.mindestStunden), formel: `mindestens ${euroText(s.mindestbetragCent)}` },
  ];
  for (const z of s.zusatzposten) zeilen.push({ label: z.bezeichnung, wert: euroText(z.betragCent), formel: "fester Zusatzposten" });
  return zeilen;
}

/** Was der Kunde zum Stunden-KV liest (Entscheidung 5b-9). */
export function stundenKundentext(s: StundenAnsicht): string {
  const n = s.mindestStunden === 1 ? "1 Stunde" : `${ZAHL.format(s.mindestStunden)} Stunden`;
  return `voraussichtlich ${euroText(s.summeGeschaetztCent)}, abgerechnet nach Aufwand, mindestens ${n} (${euroText(s.mindestbetragCent)})`;
}

/** Körper für `POST …/lock` (Entscheidung 5b-5). */
export interface SperrKoerper {
  bestaetigtSpanne: boolean;
  erwartetPreisCent?: number;
  erwartetPreisHash?: string;
  modusWechselBestaetigt?: true;
  /** Plan 15: „Preis ohne echte Fahrzeiten“ bestätigt */
  ohneAdresseBestaetigt?: true;
}

/**
 * Mit Preis-Hash (Plan 5b, die Ansicht trägt ihn) prüft der Server alle
 * Kundenpreise über `erwartetPreisHash`; der Einzelpreis fällt dann weg, weil
 * er bei Paketen, Tagen und Stunden nicht der KV-Summe entsprechen muss.
 * Ohne Hash wie vor 5b mit `erwartetPreisCent`.
 */
export function sperrKoerper(
  ansicht: Pick<KalkulationsAnsicht, "kv" | "preis" | "preisHash">,
  opts: { modusWechselBestaetigt?: boolean; ohneAdresseBestaetigt?: boolean } = {}
): SperrKoerper {
  const koerper: SperrKoerper = { bestaetigtSpanne: ansicht.kv?.obergrenze ?? false };
  if (ansicht.preisHash) koerper.erwartetPreisHash = ansicht.preisHash;
  else koerper.erwartetPreisCent = ansicht.kv?.summeCent ?? ansicht.preis.gerundetCent ?? 0;
  if (opts.modusWechselBestaetigt) koerper.modusWechselBestaetigt = true;
  if (opts.ohneAdresseBestaetigt) koerper.ohneAdresseBestaetigt = true;
  return koerper;
}

export type SperrAusgang =
  | { art: "ok" }
  /** Preis seit dem Laden geändert: Hinweis, Ansicht neu laden. */
  | { art: "preis_geaendert"; meldung: string }
  /** Stunden-Quotation würde Festpreis: erst nachfragen, dann mit `modusWechselBestaetigt`. */
  | { art: "moduswechsel"; meldung: string }
  /** Plan 15: Belade- oder Entladeadresse fehlt: nachfragen, dann mit `ohneAdresseBestaetigt`. */
  | { art: "adresse_fehlt"; meldung: string }
  | { art: "fehler"; meldung: string };

/** Antwort von `POST …/lock` einordnen; Texte kommen unverändert vom Dienst. */
export function sperrAusgang(antwort: ApiAntwort<unknown>): SperrAusgang {
  if (antwort.ok) return { art: "ok" };
  if (antwort.status === 409 && antwort.code === "PREIS_GEAENDERT") return { art: "preis_geaendert", meldung: antwort.message };
  if (antwort.status === 409 && antwort.code === "MODUSWECHSEL") return { art: "moduswechsel", meldung: antwort.message };
  if (antwort.status === 409 && antwort.code === "ADRESSE_FEHLT") return { art: "adresse_fehlt", meldung: antwort.message };
  return { art: "fehler", meldung: antwort.message };
}

/** Zustand des Knopfs „Tagespreise im Termin-Dialog“ (Entscheidung 5b-15). */
export function tagespreiseKnopf(
  schalter: KalkulationsAnsicht["schalter"],
  version: Pick<KalkulationsAnsicht["version"], "preisModus">
): { aktiv: boolean; hinweis: string | null } {
  if (!schalter.tagespreise) {
    return { aktiv: false, hinweis: "Tagespreise sind für diese Firma aus. Einschalten unter Einstellungen, Kundenportal." };
  }
  if (version.preisModus === "stunden") return { aktiv: false, hinweis: "Beim Stunden-KV gibt es keine Tagespreise." };
  return { aktiv: true, hinweis: null };
}

/** Preismodus als Wort. */
export function modusName(m: PreisModus): string {
  return m === "stunden" ? "Stunden-KV" : "Festpreis";
}
