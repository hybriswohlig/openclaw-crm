/**
 * Plan 15 „Kalkulation verlässlich“: gemeinsame Typen und Texte (Vertrag).
 * Rein, ohne Datenbank. Interne Texte für die Kalkulationsseite, kein Kundentext.
 */

/** Größenklassen des Rechners (Positionen ohne Katalogtreffer). */
export type Groessenklasse = "klein" | "mittel" | "gross" | "sperrig";
export const GROESSENKLASSEN: readonly Groessenklasse[] = ["klein", "mittel", "gross", "sperrig"];
export const GROESSENKLASSE_TEXT: Record<Groessenklasse, string> = {
  klein: "klein",
  mittel: "mittel",
  gross: "groß",
  sperrig: "sperrig",
};

// ─── Bauteil 8: Adressen aus dem Chat ─────────────────────────────────────────

/** Woher eine Adresse der Rechner-Anfrage kommt. */
export type AdressQuelle = "lead" | "ki" | "erkennung";

/** Beste Angabe aus dem Chat je Seite, nur „PLZ Ort“ (z. B. „70372 Stuttgart“) oder nur die PLZ. */
export interface ChatAdressen {
  von: string | null;
  nach: string | null;
  quelleVon: Exclude<AdressQuelle, "lead"> | null;
  quelleNach: Exclude<AdressQuelle, "lead"> | null;
}

/** Ereignis, wenn die Kalkulation eine Adresse ins Lead schreibt (Herkunft „Kalkulation, Name, Zeit“). */
export const ADRESSE_GESETZT_EVENT = "kalkulation.adresse_gesetzt";
export interface AdresseGesetztPayload {
  seite: "beladen" | "entladen";
  adresse: string;
  /** "kalkulation" = von Hand eingegeben, "chat" = Angabe aus dem Chat übernommen */
  quelle: "kalkulation" | "chat";
  version: number | null;
}

// ─── Bauteil 3: Positionen ohne Katalogtreffer ───────────────────────────────

/** Wert der Übersteuerung `art: "position"`; Schlüssel = Positionsname klein geschrieben, getrimmt. */
export interface PositionKorrektur {
  groessenklasse?: Groessenklasse;
  /** je Stück */
  volumenCbm?: number;
  /** je Stück */
  gewichtKg?: number;
}

export interface PositionOhneKatalog {
  /** Schlüssel der Übersteuerung */
  key: string;
  name: string;
  menge: number;
  groessenklasse: Groessenklasse | null;
  volumenCbm: number | null;
  gewichtKg: number | null;
  /** Wirksame Korrektur dieser Version, mit Grund */
  korrektur: (PositionKorrektur & { grund: string; von: string; am: string }) | null;
}

// ─── Bauteil 1: Kasten „Damit hat der Rechner gerechnet“ ─────────────────────

export type AnnahmeGruppeKey = "adressen" | "etagen" | "volumen" | "team" | "fahrzeit" | "weitere";

export interface AnnahmeZeile {
  text: string;
  /** `key` der Grundlage-Zeile, zu der die Zeile springt */
  ziel: string;
  /** aufklappbar: z. B. die Positionen ohne Katalogtreffer */
  details?: string[];
}

export interface AnnahmenKasten {
  gruppen: { key: AnnahmeGruppeKey; titel: string; zeilen: AnnahmeZeile[] }[];
}

// ─── Bauteil 5: Sperren ohne Adresse ─────────────────────────────────────────

export const ADRESSE_CHAT_TEXT =
  "Die Adresse stammt aus dem Chat und ist unbestätigt. Bitte ins Lead übernehmen oder bestätigen, dass der Preis damit gilt.";
export const ADRESSE_FEHLT_TEXT =
  "Ohne Belade- oder Entladeadresse rechnet der Rechner ohne echte Fahrzeiten. Bitte Adresse eintragen oder bestätigen, dass der Preis ohne echte Fahrzeiten gilt.";

// ─── Bauteil 6: KV-Posten-Werkzeug ───────────────────────────────────────────

export const KURZGRUENDE = ["Kunde macht selbst", "nicht nötig", "anders vereinbart"] as const;
export type Kurzgrund = (typeof KURZGRUENDE)[number];

/** „Kunde macht selbst: Küche baut der Schwager ab“ (Freitext optional). */
export function grundAusKurzgrund(kurz: Kurzgrund, freitext: string): string {
  const f = freitext.trim();
  return f === "" ? kurz : `${kurz}: ${f}`;
}
