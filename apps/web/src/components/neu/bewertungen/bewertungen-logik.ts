/**
 * Reine Bausteine der Seite /app/bewertungen (Plan 11, Entscheidung 12):
 * Reihenfolge und Titel der Listen, Leertexte, Zeittext je Zeile und die
 * Aktionen, die eine Zeile anbietet.
 */
import { fensterText, SPERR_TEXT, type BewertungListe, type BewertungZeile } from "@/lib/bewertungen-kunden";

export const LISTEN: readonly BewertungListe[] = ["freigabe", "vorgemerkt", "faellig", "angefragt", "geklickt", "gesperrt"];

export const LISTE_TITEL: Record<BewertungListe, string> = {
  freigabe: "Zur Freigabe",
  vorgemerkt: "Vorgemerkt",
  faellig: "Fällig",
  angefragt: "Angefragt",
  geklickt: "Geklickt",
  gesperrt: "Gesperrt",
};

export const LISTE_LEER: Record<BewertungListe, string> = {
  freigabe: "Keine Entwürfe der Automatik offen.",
  vorgemerkt: "Nichts vorgemerkt.",
  faellig: "Gerade ist keine Bewertung fällig.",
  angefragt: "Noch keine offenen Anfragen.",
  geklickt: "Noch kein Klick auf einen Bewertungslink.",
  gesperrt: "Keine gesperrten Aufträge.",
};

/** Erste Liste mit Arbeit (Freigabe, Vorgemerkt, Fällig), sonst Fällig. */
export function startListe(zaehler: Record<BewertungListe, number>): BewertungListe {
  return (["freigabe", "faellig", "vorgemerkt"] as const).find((l) => zaehler[l] > 0) ?? "faellig";
}

function tag(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("de-DE", { timeZone: "Europe/Berlin", day: "2-digit", month: "2-digit", year: "numeric" });
}

/** Zeit oder Grund der Zeile, kurz. */
export function zeileText(z: BewertungZeile): string {
  switch (z.liste) {
    case "freigabe":
      return z.faelligAb ? `Entwurf, ab ${fensterText(new Date(z.faelligAb))}` : "Entwurf";
    case "vorgemerkt":
      return z.faelligAb ? `Geht ${fensterText(new Date(z.faelligAb))} raus` : "Vorgemerkt";
    case "faellig":
      if (z.grund === "FRIST") return SPERR_TEXT.FRIST;
      return z.faelligAb ? `Fällig seit ${tag(z.faelligAb)}` : "Fällig";
    case "angefragt":
      return z.angefragtAm ? `Angefragt am ${tag(z.angefragtAm)}` : "Angefragt";
    case "geklickt":
      return z.geklicktAm ? `Geklickt am ${tag(z.geklicktAm)}` : "Geklickt";
    case "gesperrt":
      return z.grund ? SPERR_TEXT[z.grund] : "Gesperrt";
  }
}

export type ZeilenAktion = "pruefen" | "verwerfen" | "freigeben";

export function zeileAktionen(z: BewertungZeile): ZeilenAktion[] {
  if (z.liste === "freigabe") return z.vormerkungId ? ["pruefen", "verwerfen"] : ["pruefen"];
  if (z.liste === "vorgemerkt") return z.vormerkungId ? ["verwerfen"] : [];
  if (z.liste === "faellig") return ["pruefen"];
  if (z.liste === "gesperrt" && z.tokenFreigebbar) return ["freigeben"];
  return [];
}

export const AKTION_TEXT: Record<ZeilenAktion, string> = {
  pruefen: "Prüfen und senden",
  verwerfen: "Verwerfen",
  freigeben: "Im Gespräch geprüft, freigeben",
};

/** Rückfrage beim Einschalten von „Senden“ (Task D). */
export const SENDEN_RUECKFRAGE =
  "Ab jetzt gehen fällige Anfragen ohne Rückfrage raus, nur mit Einwilligung, nur für Zahlungen ab heute.";
