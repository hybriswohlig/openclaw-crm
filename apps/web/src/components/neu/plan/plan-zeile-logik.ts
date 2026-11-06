/**
 * Reine Logik der Plan-Zeile (Plan 8, Task E): Texte, die Tagesansicht und
 * „Heute“ gleich zeigen. Keine React-Abhängigkeit.
 * Anzeige deutsch, Europe/Berlin, Trenner „·“, keine Gedankenstriche.
 */
import { tagKurz } from "@/lib/anzeige";
import { liveText, type PlanEintrag, type PlanLive, type PlanTon } from "@/lib/plan-heute";

/** Bedeutung der Farbe als Text (für Screenreader und Legende; Farbe nie allein). */
export const TON_TEXT: Record<PlanTon, string> = {
  jade: "fest, Team steht",
  gold: "fest, etwas fehlt",
  violett: "Besichtigung",
  gestrichelt: "noch nicht fest",
  grau: "erledigt",
};

/** Linke Spalte: Beginn „07:30“ oder „ganztägig“. */
export function zeitSpalte(e: Pick<PlanEintrag, "von">): string {
  return e.von ?? "ganztägig";
}

/**
 * Was vom Zeittext nach der Uhrzeit der linken Spalte bleibt:
 * „07:30 Beladen · ca. 13:00 fertig“ → „Beladen · ca. 13:00 fertig“, „16:00“ → null.
 */
export function zeitRest(e: Pick<PlanEintrag, "von" | "zeitText">): string | null {
  const text = e.zeitText?.trim() ?? "";
  if (!text) return null;
  if (e.von && text.startsWith(e.von)) {
    const rest = text.slice(e.von.length).trim();
    return rest === "" ? null : rest;
  }
  return text;
}

/** Mehrtägig: „bis Sa 07.11.“, sonst null. */
export function bisText(e: Pick<PlanEintrag, "tag" | "bisTag">): string | null {
  return e.bisTag !== e.tag ? `bis ${tagKurz(e.bisTag)}` : null;
}

/**
 * Die Lücke im Team („?“) zählt nur bei festen Umzügen (jade, gold), wie auf
 * dem Board nur bei Geplant; bei Angeboten oder erledigten Einträgen nie.
 */
export function teamLuecke(e: Pick<PlanEintrag, "art" | "ton" | "teamFehlt">): boolean {
  return e.art === "umzug" && e.teamFehlt && (e.ton === "jade" || e.ton === "gold");
}

/** Team nur bei Umzügen mit Mitgliedern oder einer Lücke; Besichtigungen haben keine Mannschaft. */
export function teamZeigen(e: Pick<PlanEintrag, "art" | "ton" | "team" | "teamFehlt">): boolean {
  return e.art === "umzug" && (e.team.length > 0 || teamLuecke(e));
}

/** „Team: Mehmet K., Tobias S.“, „Team: Mehmet K., unvollständig“, „Team fehlt“. */
export function teamText(e: Pick<PlanEintrag, "art" | "ton" | "team" | "teamFehlt">): string {
  const luecke = teamLuecke(e);
  if (e.team.length === 0) return luecke ? "Team fehlt" : "Kein Team";
  const namen = e.team.map((m) => m.name).join(", ");
  return luecke ? `Team: ${namen}, unvollständig` : `Team: ${namen}`;
}

export type LiveStufe = "fertig" | "vor_ort" | "unterwegs";

/** Stand des Einsatzes für die Farbe der Live-Pille; null ohne Klick. */
export function liveStufe(l: PlanLive | null | undefined): LiveStufe | null {
  if (!l) return null;
  if (l.fertigAm) return "fertig";
  if (l.vorOrtAm) return "vor_ort";
  if (l.losAm) return "unterwegs";
  return null;
}

/** Live-Pille: Stufe und Text oder null. */
export function livePille(l: PlanLive | null | undefined): { stufe: LiveStufe; text: string } | null {
  const stufe = liveStufe(l);
  const text = liveText(l ?? null);
  return stufe && text ? { stufe, text } : null;
}

/** Vorlesetext einer Zeile: „Familie Can, fest, Team steht, 07:30, unterwegs seit 07:12“. */
export function zeileLabel(e: Pick<PlanEintrag, "titel" | "ton" | "von">, l?: PlanLive | null): string {
  return [e.titel, TON_TEXT[e.ton], zeitSpalte(e), liveText(l ?? null)].filter(Boolean).join(", ");
}
