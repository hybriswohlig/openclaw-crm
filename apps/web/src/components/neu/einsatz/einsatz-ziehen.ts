/**
 * Ziehen auf der Karte (Plan 12c, Entscheidung 5, Auftrag 10.11. Punkt 5): rein,
 * ohne React. Treffer des Ablageziels aus dem Bildschirmpunkt, Vorschau der
 * neuen Summe vor dem Loslassen und was beim Ablegen passiert. Ändert nur die
 * Auswahl; gespeichert wird erst mit „Team bestätigen“.
 */
import { ziehenErgebnis } from "@/lib/einsatz";
import type { EinsatzAnsicht, EinsatzPersonLage } from "@/lib/einsatz-ansicht";
import { auswahlHinzufuegen, imTeam, rueckfrageFuer, summeAus, type Auswahl, type Rueckfrage } from "./einsatz-logik";

/** Radius des Ablagekreises um den Beladen-Marker in px. */
export const ABLAGE_RADIUS_PX = 48;
/** Ab so vielen px Bewegung wird aus einem Klick ein Ziehen (Maus, Stift). */
export const ZIEHEN_AB_PX = 5;
/** Touch: so lange halten, bis das Ziehen startet (sonst Antippen oder Karte schieben). */
export const HALTEN_MS = 280;
/** Touch: bewegt sich der Finger vor Ablauf weiter, ist es kein Halten. */
export const HALTEN_TOLERANZ_PX = 10;

export interface Bildpunkt {
  x: number;
  y: number;
}

export interface Rechteck {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export type AblageZiel = "auftrag" | "team";

/**
 * Welches Ziel liegt unter dem Zeiger? Kreis um den Beladen-Marker (Rand
 * inklusiv), sonst eine der Team-Flächen (Summenleiste, Handy-Leiste).
 */
export function trefferZiel(
  p: Bildpunkt,
  ziele: { auftrag: Bildpunkt | null; team: readonly (Rechteck | null)[] },
  radius = ABLAGE_RADIUS_PX,
): AblageZiel | null {
  if (ziele.auftrag && Math.hypot(p.x - ziele.auftrag.x, p.y - ziele.auftrag.y) <= radius) return "auftrag";
  for (const r of ziele.team) {
    if (r && p.x >= r.left && p.x <= r.right && p.y >= r.top && p.y <= r.bottom) return "team";
  }
  return null;
}

export type Ablegen =
  | { art: "hinzufuegen"; auswahl: Auswahl }
  | { art: "rueckfrage"; rueckfrage: Rueckfrage }
  | { art: "schon_im_team"; text: string };

/**
 * Was beim Loslassen auf einem Ziel passiert (Vertrag `ziehenErgebnis`):
 * frei sofort hinzufügen; belegt oder abwesend mit Rückfrage wie in der Liste;
 * schon im Team nur ein kurzer Hinweis. Wer die Rückfrage am Tag schon bejaht
 * hat, wird ohne neue Frage hinzugefügt.
 */
export function ablegen(
  p: EinsatzPersonLage,
  s: Auswahl,
  rechner: EinsatzAnsicht["rechner"],
  tagText: string,
): Ablegen {
  const e = ziehenErgebnis(p.lage, imTeam(s, p.id));
  if (e === "schon_im_team") return { art: "schon_im_team", text: `${p.name} ist schon im Team.` };
  if (e !== "hinzufuegen") {
    const frage = rueckfrageFuer(p, tagText, s);
    if (frage) return { art: "rueckfrage", rueckfrage: frage };
  }
  return { art: "hinzufuegen", auswahl: auswahlHinzufuegen(s, p.id, rechner) };
}

export interface Vorschau {
  /** „3 im Team · 612 € · +28 € zur Kalkulation“ */
  text: string;
  summeCent: number;
  abstandCent: number | null;
  /** Rückfrage folgt beim Loslassen (belegt oder abwesend). */
  rueckfrage: "belegt" | "abwesend" | null;
  schonImTeam: boolean;
}

/** „+28 €“, „−12 €“, „±0 €“ (ganze Euro). */
export function abstandText(cent: number): string {
  const e = Math.round(cent / 100);
  if (e === 0) return "±0 €";
  return `${e > 0 ? "+" : "−"}${Math.abs(e).toLocaleString("de-DE")} €`;
}

/** Kompakte Zeile für Handy-Leiste und Vorschau: „3 im Team · 612 € · +28 € zur Kalkulation“. */
export function kompaktText(n: number, summeCent: number, abstandCent: number | null): string {
  const teile = [`${n} im Team`, `${Math.round(summeCent / 100).toLocaleString("de-DE")} €`];
  if (abstandCent !== null) teile.push(`${abstandText(abstandCent)} zur Kalkulation`);
  return teile.join(" · ");
}

/**
 * Neue Gesamtsumme und Abstand zur Kalkulation, wenn `p` jetzt abgelegt würde
 * (dieselben Funktionen wie Liste und Server). Für jemanden im Team die
 * heutige Summe.
 */
export function ziehenVorschau(
  p: EinsatzPersonLage,
  s: Auswahl,
  a: Pick<EinsatzAnsicht, "personen" | "rechner" | "anfahrten">,
): Vorschau {
  const schon = imTeam(s, p.id);
  const neu = schon ? s : auswahlHinzufuegen(s, p.id, a.rechner);
  const { vergleich } = summeAus(neu, a);
  const e = ziehenErgebnis(p.lage, schon);
  return {
    text: kompaktText(neu.team.length, vergleich.summeCent, vergleich.differenzCent),
    summeCent: vergleich.summeCent,
    abstandCent: vergleich.differenzCent,
    rueckfrage: s.bestaetigtAmTag.includes(p.id) ? null : e === "rueckfrage_belegt" ? "belegt" : e === "rueckfrage_abwesend" ? "abwesend" : null,
    schonImTeam: schon,
  };
}
