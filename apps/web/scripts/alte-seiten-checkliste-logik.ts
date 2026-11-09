/**
 * Plan 14, Task L: reine Hilfen der Lösch-Checkliste (keine Datenbank).
 * Das Skript `alte-seiten-checkliste.ts` liest die Ereignisse und druckt den Bericht.
 */
import { ZUORDNUNG, quotationStufe, umleitZiel } from "../src/lib/dunkel-abschaltung";
import { altUmleitung } from "../src/lib/handy-links";

export const AUFRUF =
  "Aufruf: npx tsx apps/web/scripts/alte-seiten-checkliste.ts --umleitung-seit YYYY-MM-DD [--entschieden /email,/tasks] [--inhaber-okay YYYY-MM-DD]";

/** Zeilen der Plan-Checkliste, die das Skript nicht aus der Datenbank belegen kann. */
export const VON_HAND = [
  "Crons, Push und Bots verweisen auf keinen zu löschenden Pfad (Plan 10 hat die Quellen umgestellt; grep über services, lib, public/sw.js ohne Treffer).",
  "Aufgaben-Modul: entschieden, bevor /tasks* oder der Akten-Reiter „Aufgaben“ fällt (Cron check-overdue-tasks, completeAgentPriceTasks).",
] as const;

export const FENSTER_TAGE = 14;
const TAG_MS = 24 * 60 * 60 * 1000;

const OFFENE_PFADE = new Set(ZUORDNUNG.filter((z) => z.neu === null).map((z) => z.alt));

export interface Argumente {
  umleitungSeit: Date;
  entschieden: string[];
  inhaberOkay: Date | null;
}

export function datumLesen(roh: string | undefined): Date | null {
  if (!roh || !/^\d{4}-\d{2}-\d{2}$/.test(roh)) return null;
  const [y, m, d] = roh.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return dt;
}

/** `--umleitung-seit` ist Pflicht. Fehlertext beginnt mit der Aufrufzeile. */
export function argumenteLesen(argv: string[]): { ok: true; wert: Argumente } | { ok: false; fehler: string } {
  const fehler = (text: string) => ({ ok: false as const, fehler: `${AUFRUF}\n${text}` });
  let umleitung: string | undefined;
  let entschiedenRoh: string | undefined;
  let okayRoh: string | undefined;
  const gesehen = new Set<string>();

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg !== "--umleitung-seit" && arg !== "--entschieden" && arg !== "--inhaber-okay") {
      return fehler(`Unbekanntes Argument: ${arg}`);
    }
    if (gesehen.has(arg)) return fehler(`${arg} doppelt angegeben.`);
    gesehen.add(arg);
    const wert = argv[i + 1];
    if (wert === undefined || wert.startsWith("--")) return fehler(`${arg} braucht einen Wert.`);
    i++;
    if (arg === "--umleitung-seit") umleitung = wert;
    else if (arg === "--entschieden") entschiedenRoh = wert;
    else okayRoh = wert;
  }

  if (umleitung === undefined) return fehler("--umleitung-seit fehlt (echtes Datum YYYY-MM-DD).");
  const umleitungSeit = datumLesen(umleitung);
  if (!umleitungSeit) return fehler("--umleitung-seit muss ein echtes Datum YYYY-MM-DD sein.");

  const entschieden: string[] = [];
  if (entschiedenRoh !== undefined) {
    const teile = entschiedenRoh.split(",").map((t) => t.trim()).filter((t) => t.length > 0);
    if (teile.length === 0) return fehler("--entschieden braucht mindestens einen offenen Pfad (zum Beispiel /email,/tasks).");
    for (const pfad of teile) {
      if (!OFFENE_PFADE.has(pfad)) return fehler(`--entschieden enthält keinen offenen alten Pfad: ${pfad}.`);
      if (!entschieden.includes(pfad)) entschieden.push(pfad);
    }
  }

  let inhaberOkay: Date | null = null;
  if (okayRoh !== undefined) {
    inhaberOkay = datumLesen(okayRoh);
    if (!inhaberOkay) return fehler("--inhaber-okay muss ein echtes Datum YYYY-MM-DD sein.");
  }

  return { ok: true, wert: { umleitungSeit, entschieden, inhaberOkay } };
}

/**
 * Zeitpunkt der ersten Stufe `sperren` nach dem letzten `zaehlen`.
 * Null, wenn es keine Sperre gibt oder das jüngste Ereignis wieder `zaehlen` ist.
 */
export function quotationGesperrtSeit(ereignisse: { am: Date; stufe: string }[]): Date | null {
  if (ereignisse.length === 0) return null;
  const zeilen = [...ereignisse]
    .map((e) => ({ am: e.am, stufe: quotationStufe(e.stufe) }))
    .sort((a, b) => a.am.getTime() - b.am.getTime());
  if (zeilen[zeilen.length - 1].stufe !== "sperren") return null;
  let letztesZaehlen = -1;
  for (let i = 0; i < zeilen.length; i++) {
    if (zeilen[i].stufe === "zaehlen") letztesZaehlen = i;
  }
  for (let i = letztesZaehlen + 1; i < zeilen.length; i++) {
    if (zeilen[i].stufe === "sperren") return zeilen[i].am;
  }
  return null;
}

export interface AufrufZeile {
  am: Date;
  pfad: string;
  ui: "neu" | "alt" | null;
  mitAlt: boolean;
}

export interface AufrufGruppe {
  pfad: string;
  zahl: number;
  letzter: Date;
}

/** Würde die Middleware den Pfad ohne Abfrage umleiten (Plan 14 oder Plan 10)? */
export function pfadWirdUmgeleitet(pfad: string): boolean {
  const suche = new URLSearchParams();
  return umleitZiel(pfad, suche) !== null || altUmleitung(pfad, suche, "neu") !== null;
}

/**
 * Aufrufe umgeleiteter alter Pfade mit `mitAlt` oder `ui = neu`,
 * gruppiert nach Pfad (Zahl und letzter Zeitpunkt).
 */
export function umgeleiteteAufrufe(zeilen: AufrufZeile[]): AufrufGruppe[] {
  const m = new Map<string, AufrufGruppe>();
  for (const z of zeilen) {
    if (z.mitAlt !== true && z.ui !== "neu") continue;
    if (!pfadWirdUmgeleitet(z.pfad)) continue;
    const da = m.get(z.pfad);
    if (!da) m.set(z.pfad, { pfad: z.pfad, zahl: 1, letzter: z.am });
    else {
      da.zahl += 1;
      if (z.am.getTime() > da.letzter.getTime()) da.letzter = z.am;
    }
  }
  return [...m.values()].sort((a, b) => (a.pfad < b.pfad ? -1 : a.pfad > b.pfad ? 1 : 0));
}

/** Offene Ziele aus `ZUORDNUNG` (`neu: null`), die `--entschieden` nicht nennt. */
export function offeneZiele(entschieden: readonly string[]): string[] {
  const weg = new Set(entschieden);
  return ZUORDNUNG.filter((z) => z.neu === null && !weg.has(z.alt)).map((z) => z.alt);
}

/** Abgelehnte `quotation.put` im Fenster, je Quelle. Grenze inklusive. */
export function abgelehnteNachQuelle(
  zeilen: { am: Date; quelle: string; abgelehnt: boolean }[],
  jetzt: Date,
  tage = FENSTER_TAGE
): { quelle: string; zahl: number }[] {
  const grenze = jetzt.getTime() - tage * TAG_MS;
  const m = new Map<string, number>();
  for (const z of zeilen) {
    if (!z.abgelehnt || z.am.getTime() < grenze) continue;
    m.set(z.quelle, (m.get(z.quelle) ?? 0) + 1);
  }
  return [...m.entries()]
    .map(([quelle, zahl]) => ({ quelle, zahl }))
    .sort((a, b) => (a.quelle < b.quelle ? -1 : a.quelle > b.quelle ? 1 : 0));
}

export function abgelehntPunkt(zahl: number): string | null {
  if (zahl <= 0) return null;
  return `${zahl} abgelehnte PUT /quotation in 14 Tagen`;
}
