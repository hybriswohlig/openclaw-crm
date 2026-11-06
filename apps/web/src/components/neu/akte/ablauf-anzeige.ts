/**
 * Reine Anzeige-Logik des Ablauf-Panels (Plan 3, Task 12): Beschriftungen der
 * Wer-Marke und der Zustände, der Link zur alten Kalkulation, der Schritt, auf
 * den das Panel am Handy eingeklappt wird, und die rechte Spalte der
 * Nachfass-Sequenz. Kein React, kein Netz; die Schritte kommen aus `lib/ablauf.ts`.
 */
import type { AblaufSchritt } from "@/lib/ablauf";

type Wer = NonNullable<AblaufSchritt["wer"]>;
type Sequenz = NonNullable<AblaufSchritt["sequenz"]>[number];

/** Text der Wer-Marke; die Marke selbst setzt die Schrift in Versalien. */
export const WER_LABEL: Record<Wer, string> = {
  auto: "auto",
  intern: "intern",
  du: "du",
  kunde: "Kunde",
};

/** Zustand als Text für Vorleseprogramme (die Farbe des Kreises allein reicht nicht). */
export const ZUSTAND_TEXT: Record<AblaufSchritt["zustand"], string> = {
  erledigt: "erledigt",
  jetzt: "aktueller Schritt",
  offen: "offen",
  entfaellt: "entfällt",
};

/** Zustände, in denen ein Schritt noch eine Aktion anbietet. */
export function schrittOffen(zustand: AblaufSchritt["zustand"]): boolean {
  return zustand === "jetzt" || zustand === "offen";
}

/**
 * `altLink` mit `?tab=…` (Entscheidung 3): „/objects/deals/1“ → „…?tab=quotation“;
 * hat der Link schon eine Abfrage, wird mit „&“ angehängt.
 */
export function mitTab(altLink: string, tab: string): string {
  const trenner = altLink.includes("?") ? "&" : "?";
  return `${altLink}${trenner}tab=${encodeURIComponent(tab)}`;
}

/**
 * Index des Schritts, den das Panel am Handy allein zeigt: der Schritt `jetzt`,
 * sonst (Verloren, Kein Lead, alles erledigt) der letzte erledigte, sonst der erste.
 */
export function fokusIndex(schritte: readonly Pick<AblaufSchritt, "zustand">[]): number {
  const jetzt = schritte.findIndex((s) => s.zustand === "jetzt");
  if (jetzt >= 0) return jetzt;
  for (let i = schritte.length - 1; i >= 0; i--) {
    if (schritte[i].zustand === "erledigt") return i;
  }
  return 0;
}

const ART_TEXT: Record<Sequenz["art"], string> = { auto: "auto", entwurf: "Entwurf", gesendet: "" };

/** Rechte Spalte einer Sequenz-Zeile: „morgen · auto“, „11.11. · Entwurf“, „gesendet Di 04.11.“. */
export function sequenzRechts(e: Pick<Sequenz, "wann" | "art">): string {
  const art = ART_TEXT[e.art];
  return art ? `${e.wann} · ${art}` : e.wann;
}
