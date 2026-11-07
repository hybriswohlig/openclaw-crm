/**
 * Reine Logik des Dialogs „Neuer Lead“ (Plan 10, Entscheidung 10): Vorgaben,
 * Prüfung vor dem Senden (dieselbe wie die Route, `neuerLeadPruefen`) und die
 * Auswertung der Antwort von `POST /api/v1/leads`. Treffer zur Nummer ordnet
 * nie die Oberfläche zu: der Dialog fragt nach.
 */
import { SOURCE_CHANNEL_OPTIONS } from "@/lib/deal-source";
import { neuerLeadPruefen, type Karte, type NeuerLeadFeld, type PersonWahl } from "@/lib/handy-links";

export interface NeuerLeadFormular {
  name: string;
  telefon: string;
  email: string;
  firmaId: string;
  quelle: string;
  umzugsdatum: string;
}

export const QUELLE_VORGABE = "Telefon";

export function leeresFormular(firmen: readonly Karte[]): NeuerLeadFormular {
  return {
    name: "",
    telefon: "",
    email: "",
    firmaId: firmen.length === 1 ? firmen[0].id : "",
    quelle: QUELLE_VORGABE,
    umzugsdatum: "",
  };
}

export type KoerperErgebnis =
  | { ok: true; koerper: NeuerLeadFormular & { personWahl: PersonWahl | null } }
  | { ok: false; feld: NeuerLeadFeld; text: string };

/** Prüft wie die Route; der Körper geht roh, der Server glättet selbst. */
export function neuerLeadKoerper(f: NeuerLeadFormular, wahl: PersonWahl | null): KoerperErgebnis {
  const koerper = { ...f, personWahl: wahl };
  const p = neuerLeadPruefen(koerper, SOURCE_CHANNEL_OPTIONS);
  return p.ok ? { ok: true, koerper } : { ok: false, feld: p.feld, text: p.text };
}

export type NeuerLeadErgebnis =
  | { art: "fertig"; dealRecordId: string }
  | { art: "rueckfrage"; treffer: Karte[] }
  | { art: "feld"; feld: NeuerLeadFeld; text: string }
  | { art: "fehler"; text: string };

const FELDER: readonly NeuerLeadFeld[] = ["name", "kontakt", "email", "firma", "quelle", "umzugsdatum", "personWahl"];

function alsKarten(wert: unknown): Karte[] {
  if (!Array.isArray(wert)) return [];
  return wert.filter(
    (k): k is Karte => !!k && typeof k === "object" && typeof (k as Karte).id === "string" && typeof (k as Karte).name === "string"
  );
}

/** Antwort der Route (Status und JSON-Körper). */
export function neuerLeadErgebnis(status: number, body: unknown): NeuerLeadErgebnis {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const fehler = (b.error && typeof b.error === "object" ? b.error : {}) as Record<string, unknown>;
  const meldung = typeof fehler.message === "string" && fehler.message.trim() ? fehler.message : null;
  if (status >= 200 && status < 300) {
    const d = (b.data && typeof b.data === "object" ? b.data : {}) as Record<string, unknown>;
    if (typeof d.dealRecordId === "string" && d.dealRecordId) return { art: "fertig", dealRecordId: d.dealRecordId };
    return { art: "fehler", text: "Die Antwort des Servers war unvollständig." };
  }
  if (status === 409) return { art: "rueckfrage", treffer: alsKarten(b.treffer) };
  if (status === 400 && typeof fehler.feld === "string" && (FELDER as readonly string[]).includes(fehler.feld)) {
    return { art: "feld", feld: fehler.feld as NeuerLeadFeld, text: meldung ?? "Bitte die Eingabe prüfen." };
  }
  if (status === 403) return { art: "fehler", text: meldung ?? "Keine Berechtigung zum Anlegen." };
  if (status === 0) return { art: "fehler", text: "Keine Verbindung zum Server." };
  return { art: "fehler", text: meldung ?? `Der Server hat mit Fehler ${status} geantwortet.` };
}
