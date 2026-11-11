/**
 * Plan 16, Bauteil 3: Vergleich alt ↔ neu zweier Kalkulationsversionen (maßgebliche
 * Version gegen den Entwurf der Änderung). Rein, ohne Datenbank: liest nur die
 * gespeicherten Schnappschüsse (Rechner-Anfrage und -Ergebnis, Preis, Marge).
 */
import type { RechnerErgebnis } from "@/services/rechner/client";
import type { RechnerAnfrage } from "@/services/rechner/eingabe";
import type { Quelle, Wer } from "./angebot-aenderung";

/** Was der Vergleich von einer Version braucht. */
export interface VersionsSchnitt {
  version: number;
  /** Kundenpreis der Version in Cent (gesperrt: festgeschrieben; Entwurf: Rechnerpreis). */
  priceCents: number | null;
  /** Wirksame Marge in Prozent (Rechner `preis.margeWirksamProzent`, sonst gewählte). */
  margeProzent: number | null;
  anfrage: RechnerAnfrage | null;
  ergebnis: RechnerErgebnis | null;
}

export type VergleichArt =
  | "teil_hinzu"
  | "teil_weg"
  | "teil_menge"
  | "montage"
  | "eingabe"
  | "posten_hinzu"
  | "posten_weg";

export interface VergleichZeile {
  art: VergleichArt;
  /** Schlüssel wie `herkunftSchluessel` (`teil:<key>`, `montage:<key>`, `eingabe:<feld>`, `posten:<bez>`, `hebel:<art>`). */
  schluessel: string;
  /** „Fahrrad“, „Halteverbot Einzug“, „Bett: Aufbau“ … */
  text: string;
  alt: string | null;
  neu: string | null;
  herkunft: Quelle;
}

export interface VonBis<T> {
  alt: T | null;
  neu: T | null;
}

export interface Vergleich {
  altVersion: number;
  neuVersion: number;
  zeilen: VergleichZeile[];
  volumenCbm: VonBis<number>;
  team: VonBis<number>;
  personenStunden: VonBis<number>;
  preisCent: VonBis<number> & { differenzCent: number | null };
  margeProzent: VonBis<number>;
}

/** Wer je Seite (für die Montage-Zeilen); exportiert für Tests und Anzeige. */
export type MontageSeiten = { abbau: Wer; aufbau: Wer };

/**
 * Vergleicht zwei Versionen. `herkunft(schluessel)` liefert die Herkunft einer Zeile
 * (aus den übernommenen Vorschlägen, sonst „hand“).
 */
export function vergleichVersionen(
  alt: VersionsSchnitt,
  neu: VersionsSchnitt,
  herkunft: (schluessel: string) => Quelle
): Vergleich {
  void alt;
  void neu;
  void herkunft;
  throw new Error("noch nicht umgesetzt");
}
