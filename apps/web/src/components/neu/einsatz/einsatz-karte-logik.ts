/**
 * Reine Hilfen der Karten-Ansicht (Plan 12c, Auftrag 10.11.): Filter über der
 * Karte, Pin-Beschriftung, längste Anfahrt, Rückgängig und gemerkte Wahl je
 * Browser. Ohne React, ohne MapLibre.
 */
import { UMKREIS_KM, UMKREIS_VORGABE, type Anfahrt, type KartenPerson, type PinGruppe, type UmkreisKm } from "@/lib/einsatz";
import type { EinsatzPersonLage } from "@/lib/einsatz-ansicht";
import type { Auswahl } from "./einsatz-logik";

// ─── Gemerkte Wahl je Browser ────────────────────────────────────────────────

export type EinsatzAnsichtArt = "liste" | "karte";
export const ANSICHT_SCHLUESSEL = "neu.einsatz.ansicht";
export const UMKREIS_SCHLUESSEL = "neu.einsatz.umkreis";

type Ablage = Pick<Storage, "getItem" | "setItem">;

function ablage(): Ablage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function ansichtLesen(s: Ablage | null = ablage()): EinsatzAnsichtArt {
  try {
    return s?.getItem(ANSICHT_SCHLUESSEL) === "karte" ? "karte" : "liste";
  } catch {
    return "liste";
  }
}

export function ansichtMerken(a: EinsatzAnsichtArt, s: Ablage | null = ablage()): void {
  try {
    s?.setItem(ANSICHT_SCHLUESSEL, a);
  } catch {
    // Privates Fenster oder gesperrter Speicher: nur nicht merken.
  }
}

export function umkreisLesen(s: Ablage | null = ablage()): UmkreisKm {
  try {
    const roh = s?.getItem(UMKREIS_SCHLUESSEL);
    if (roh === "0") return 0;
    const n = Number(roh);
    return (UMKREIS_KM as readonly number[]).includes(n) ? (n as UmkreisKm) : UMKREIS_VORGABE;
  } catch {
    return UMKREIS_VORGABE;
  }
}

export function umkreisMerken(km: UmkreisKm, s: Ablage | null = ablage()): void {
  try {
    s?.setItem(UMKREIS_SCHLUESSEL, String(km));
  } catch {
    // nur nicht merken
  }
}

// ─── Filter über der Karte ───────────────────────────────────────────────────

export interface KartenFilter {
  nurFrei: boolean;
  sprinter: boolean;
  pkw: boolean;
  /** Abwesende zeigen (Vorgabe aus, „alle zeigen“). */
  alle: boolean;
}

export const FILTER_VORGABE: KartenFilter = { nurFrei: false, sprinter: false, pkw: false, alle: false };

/**
 * Wer auf der Karte steht: Team-Mitglieder immer; sonst nach Filter. Abwesende
 * nur mit „alle zeigen“, „Nur frei“ blendet auch Belegte aus.
 */
export function kartenPersonenFiltern(
  personen: readonly KartenPerson[],
  filter: KartenFilter,
  details: ReadonlyMap<string, Pick<EinsatzPersonLage, "kannSprinter" | "eigenerPkw">>,
  teamIds: readonly string[],
): KartenPerson[] {
  return personen.filter((p) => {
    if (teamIds.includes(p.employeeId)) return true;
    if (p.lage === "abwesend" && !filter.alle) return false;
    if (filter.nurFrei && p.lage !== "frei") return false;
    const d = details.get(p.employeeId);
    if (filter.sprinter && !d?.kannSprinter) return false;
    if (filter.pkw && !d?.eigenerPkw) return false;
    return true;
  });
}

/** Wie viele Abwesende der Filter gerade versteckt (für „Abwesende zeigen (N)“). */
export function versteckteAbwesende(personen: readonly KartenPerson[], teamIds: readonly string[]): number {
  return personen.filter((p) => p.lage === "abwesend" && !teamIds.includes(p.employeeId)).length;
}

// ─── Pins ────────────────────────────────────────────────────────────────────

/** Anfahrt in Minuten am Pin; null ohne Wert. */
export function anfahrtMin(anfahrten: readonly Anfahrt[], id: string): number | null {
  return anfahrten.find((a) => a.employeeId === id)?.anMin ?? null;
}

/**
 * Beschriftung eines Pins: bis zu drei Kürzel, „+N“ für den Rest, kürzeste
 * Anfahrt am Ort: „MK · 22 min“, „MK AR TS +2 · 18 min“.
 */
export function pinText(g: Pick<PinGruppe, "personen">, anfahrten: readonly Anfahrt[]): { kuerzel: string[]; mehr: number; minuten: number | null; text: string } {
  const kuerzel = g.personen.slice(0, 3).map((p) => p.kuerzel);
  const mehr = Math.max(0, g.personen.length - 3);
  const werte = g.personen.map((p) => anfahrtMin(anfahrten, p.employeeId)).filter((m): m is number => m !== null);
  const minuten = werte.length > 0 ? Math.min(...werte) : null;
  const teile = [kuerzel.join(" ") + (mehr > 0 ? ` +${mehr}` : "")];
  if (minuten !== null) teile.push(`${minuten} min`);
  return { kuerzel, mehr, minuten, text: teile.join(" · ") };
}

export const LAGE_WORT = { frei: "frei", belegt: "belegt", abwesend: "abwesend" } as const;

/** Lage einer Gruppe für Farbe und Symbol: ausgewählt, wenn jemand im Team ist; sonst die beste Lage. */
export function gruppenLage(g: Pick<PinGruppe, "personen">, teamIds: readonly string[]): "team" | "frei" | "belegt" | "abwesend" {
  if (g.personen.some((p) => teamIds.includes(p.employeeId))) return "team";
  return g.personen[0]?.lage ?? "frei";
}

/** „A. Keller“ aus „Anna Keller“; ein Wort bleibt. */
export function kurzName(name: string): string {
  const w = name.trim().split(/\s+/).filter(Boolean);
  if (w.length < 2) return w[0] ?? "";
  return `${Array.from(w[0]!)[0]}. ${w[w.length - 1]}`;
}

/** Teamkarte: „Längste Anfahrt: 31 min, A. Keller“; null ohne Minuten. */
export function laengsteAnfahrt(teamIds: readonly string[], anfahrten: readonly Anfahrt[], namen: Readonly<Record<string, string>>): string | null {
  let best: { id: string; min: number } | null = null;
  for (const id of teamIds) {
    const m = anfahrtMin(anfahrten, id);
    if (m !== null && (best === null || m > best.min)) best = { id, min: m };
  }
  return best ? `Längste Anfahrt: ${best.min} min, ${kurzName(namen[best.id] ?? "")}` : null;
}

// ─── Rückgängig ──────────────────────────────────────────────────────────────

/** Höchstens so viele Schritte zurück. */
export const VERLAUF_MAX = 30;

export interface Verlauf {
  vorher: Auswahl[];
}

export const VERLAUF_LEER: Verlauf = { vorher: [] };

/** Merkt den Stand vor einer Teamänderung (nur wenn sich etwas ändert). */
export function verlaufMerken(v: Verlauf, alt: Auswahl, neu: Auswahl): Verlauf {
  if (alt === neu) return v;
  return { vorher: [...v.vorher, alt].slice(-VERLAUF_MAX) };
}

/** Einen Schritt zurück: `[neuer Verlauf, Auswahl]`, null ohne Schritt. */
export function verlaufZurueck(v: Verlauf): [Verlauf, Auswahl] | null {
  const letzte = v.vorher[v.vorher.length - 1];
  if (!letzte) return null;
  return [{ vorher: v.vorher.slice(0, -1) }, letzte];
}
