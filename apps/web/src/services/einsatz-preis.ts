/**
 * Plan 12b, Entscheidung 5: was die Kalkulation aus dem Einsatz an den Rechner
 * schickt. Station und Klasse kommen aus den Übersteuerungen (`station`,
 * `fahrzeugklasse`, schon in der Anfrage); die Buchung nur mit Firmen-Schalter
 * `buchung_im_preis`, zugeordneter, nicht stornierter Buchung und wenn Station
 * und Klasse noch im Rechner stehen. Ist der Rechner für die Stammdaten nicht
 * erreichbar, geht die Buchung trotzdem mit (der Rechner prüft selbst und
 * antwortet sonst 400).
 */
import { buchungsAnteil } from "@/lib/einsatz";
import type { EinsatzAnfrage } from "./rechner/eingabe";

export interface EinsatzPreisKontext {
  anfrage: EinsatzAnfrage;
  /** Für die Kalkulationsseite: „Station und Fahrzeug kommen aus der Buchung.“ u. ä. */
  hinweis: string | null;
}

export const HINWEIS_AUS_BUCHUNG = "Station und Fahrzeug kommen aus der Buchung.";
export const HINWEIS_BUCHUNG_FEHLT_IM_RECHNER = "Station oder Klasse der Buchung gibt es im Rechner nicht mehr.";
export const HINWEIS_ANBIETER_PASST_NICHT =
  "Klasse und Station der Buchung gehören im Rechner zu verschiedenen Anbietern. Die Kalkulation rechnet ohne Buchung, bis die Buchung oder der Rechner angepasst ist.";

type Schalter = (ws: string, deal: string) => Promise<{ buchungImPreis: boolean }>;

/** `schalter`: Leser des Firmen-Schalters (Vorgabe `einsatzSchalter`); fehlt er, ist die Buchung im Preis aus. */
export async function einsatzPreisKontext(ws: string, deal: string, schalter?: Schalter | null): Promise<EinsatzPreisKontext | null> {
  const lesen = schalter === undefined ? (await import("@/services/plan5-schalter")).einsatzSchalter : schalter;
  if (typeof lesen !== "function" || !(await lesen(ws, deal)).buchungImPreis) return null;
  const { dealBuchung } = await import("@/services/einsatz-buchungen");
  const b = await dealBuchung(ws, deal);
  if (!b || b.status === "storniert") return null;
  try {
    const { rechnerKlassen, rechnerStationen } = await import("@/services/rechner/stammdaten");
    const [stationen, klassen] = await Promise.all([rechnerStationen(), rechnerKlassen()]);
    const station = stationen.find((s) => s.id === b.stationId && s.aktiv);
    const klasse = klassen.find((k) => k.id === b.klasseId && k.aktiv);
    if (!station || !klasse) return { anfrage: { station: null, klasse: null, buchung: null }, hinweis: HINWEIS_BUCHUNG_FEHLT_IM_RECHNER };
    // Review M8: sonst antwortet der Rechner nur „Keine aktive Mietstation …“.
    if (station.anbieter !== klasse.anbieter) {
      return { anfrage: { station: null, klasse: null, buchung: null }, hinweis: HINWEIS_ANBIETER_PASST_NICHT };
    }
  } catch {
    // Stammdaten nicht erreichbar: der Rechner prüft Station und Klasse selbst.
  }
  return { anfrage: { station: null, klasse: null, buchung: { b, anteil: buchungsAnteil(b) } }, hinweis: HINWEIS_AUS_BUCHUNG };
}
