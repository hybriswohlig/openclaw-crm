/**
 * Auftrags-Tabelle (CSV) zum Einteilen (Inhaber 19.11.): alle anstehenden
 * festen Umzüge mit dem heutigen Team. Ausgefüllt zurück, Vorschau, dann
 * übernehmen. Gelesen werden nur die Auftrag-ID und die zwei Team-Spalten;
 * beide leer = nichts ändern. „-“ statt Namen = Team leeren. Rein, ohne Datenbank.
 */
import type { EinsatzPerson, TeamRolle } from "./einsatz";
import { csvNorm, csvZelle } from "./mitarbeiter-csv";

export interface AnstehenderAuftrag {
  dealId: string;
  /** Inklusiv, „YYYY-MM-DD“. */
  tag: string;
  bisTag: string;
  /** „HH:MM“ oder null. */
  von: string | null;
  firma: string | null;
  titel: string;
  strecke: string | null;
  /** Heutiges Team in Reihenfolge der Einteilung. */
  team: Array<{ employeeId: string; role: TeamRolle }>;
}

export const AUFTRAG_SPALTEN = [
  "Auftrag-ID (nicht ändern)",
  "Datum",
  "Uhrzeit",
  "Firma",
  "Kunde",
  "Strecke",
  "Teamleitung",
  "Helfer (Namen mit Komma)",
] as const;

const WOCHENTAG = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];

function tagText(tag: string, mitJahr: boolean): string {
  const [j, m, d] = tag.split("-").map(Number) as [number, number, number];
  const wt = WOCHENTAG[new Date(Date.UTC(j, m - 1, d)).getUTCDay()];
  return `${wt} ${String(d).padStart(2, "0")}.${String(m).padStart(2, "0")}.${mitJahr ? j : ""}`;
}

/** „Sa 22.11.2026“, mehrtägig „Sa 22.11.–So 23.11.2026“ (mit Wochentag bleibt es in Excel Text). */
export function datumText(tag: string, bisTag: string): string {
  return bisTag > tag ? `${tagText(tag, false)}–${tagText(bisTag, true)}` : tagText(tag, true);
}

/** Vorlage: eine Zeile je anstehendem Auftrag, nach Datum, mit dem heutigen Team. */
export function auftraegeCsv(auftraege: AnstehenderAuftrag[], personen: EinsatzPerson[]): string {
  const name = (id: string) => personen.find((p) => p.id === id)?.name ?? "";
  const zeilen = [AUFTRAG_SPALTEN.map(csvZelle).join(";")];
  for (const a of [...auftraege].sort((x, y) => (x.tag + (x.von ?? "99:99") < y.tag + (y.von ?? "99:99") ? -1 : 1))) {
    const lead = a.team.find((t) => t.role === "lead");
    const helfer = a.team.filter((t) => t !== lead).map((t) => name(t.employeeId));
    zeilen.push(
      [a.dealId, datumText(a.tag, a.bisTag), a.von ?? "", a.firma ?? "", a.titel, a.strecke ?? "", lead ? name(lead.employeeId) : "", helfer.join(", ")]
        .map(csvZelle)
        .join(";"),
    );
  }
  return "﻿" + zeilen.join("\r\n") + "\r\n";
}

// ─── Lesen ───────────────────────────────────────────────────────────────────

export interface TeamImportZeile {
  /** Zeile in der Datei (Kopf = 1). */
  nr: number;
  dealId: string | null;
  /** Aus der Datenbank, sonst aus der Datei. */
  titel: string;
  datum: string;
  art: "aendern" | "gleich" | "fehler";
  /** Namen, Teamleitung zuerst. */
  alt: string[];
  neu: string[];
  /** Gewünschtes Team (Leitung zuerst), nur bei `aendern`. */
  team: Array<{ employeeId: string; role: TeamRolle }>;
  fehler: string[];
  /** Bewusst doppelt am Tag (wie „trotzdem einteilen“ im Einsatz-Dialog): wird eingeteilt, nur Hinweis. */
  hinweise: string[];
  /** Personen für `bestaetigtAmTag`. */
  trotzdem: string[];
}

const LEER_MARKE = new Set(["-", "–", "—", "keiner", "keine", "niemand", "leer", "x"]);

/** Namen aus einer Zelle: Komma, Schrägstrich, Plus, Zeilenumbruch, „und“, „&“. */
export function namenAus(zelle: string): string[] {
  return zelle
    .split(/[,/+\n\r&;]|\s+und\s+/i)
    .map((x) => x.trim())
    .filter((x) => x !== "" && !LEER_MARKE.has(x.toLowerCase()));
}

type Treffer = { ok: EinsatzPerson } | { fehler: string };

/**
 * Person zum Namen: erst der ganze Name, dann ein einzelnes Wort des Namens
 * („Nuri“ für „Nurullah Nuri“), dann der Anfang. Mehrdeutig oder unbekannt
 * ist ein Fehler, nie eine Vermutung.
 */
export function personZumNamen(roh: string, personen: readonly EinsatzPerson[]): Treffer {
  const n = csvNorm(roh);
  // Zusatz in Klammern („Andi Herrmann (Probe)“) zählt nur, wenn er auch im Namen steht.
  const ohneKlammer = (x: string) => csvNorm(x.replace(/\([^)]*\)/g, ""));
  const nk = ohneKlammer(roh);
  const stufen = [
    personen.filter((p) => csvNorm(p.name) === n),
    personen.filter((p) => nk !== "" && ohneKlammer(p.name) === nk),
    personen.filter((p) => p.name.split(/\s+/).some((w) => csvNorm(w) === n)),
    personen.filter((p) => n.length >= 3 && csvNorm(p.name).startsWith(n)),
  ];
  for (const s of stufen) {
    // Aktive zuerst: eine frühere Person gleichen Namens macht nichts mehrdeutig.
    const aktiv = s.filter((p) => p.aktiv);
    const liste = aktiv.length > 0 ? aktiv : s;
    if (liste.length === 1) return { ok: liste[0]! };
    if (liste.length > 1) return { fehler: `„${roh}“ passt auf mehrere: ${liste.map((p) => p.name).join(", ")}. Bitte den ganzen Namen schreiben.` };
  }
  return { fehler: `„${roh}“ kennen wir nicht. Bitte erst in der Mitarbeiter-Tabelle anlegen.` };
}

function spalteAusKopf(kopf: string): "id" | "leitung" | "helfer" | null {
  const k = csvNorm(kopf);
  if (k.startsWith("auftrag") || k.startsWith("id")) return "id";
  if (k.startsWith("teamleit") || k.startsWith("leitung") || k.startsWith("lead")) return "leitung";
  if (k.startsWith("helfer") || k.startsWith("team")) return "helfer";
  return null;
}

const ueberlappt = (a: { tag: string; bisTag: string }, b: { tag: string; bisTag: string }) => a.tag <= b.bisTag && b.tag <= a.bisTag;

export function teamImportPlan(
  tabelle: string[][],
  auftraege: readonly AnstehenderAuftrag[],
  personen: readonly EinsatzPerson[],
): { zeilen: TeamImportZeile[]; kopfFehlt: string[] } {
  const [kopf = [], ...rest] = tabelle;
  const spalte: Partial<Record<"id" | "leitung" | "helfer", number>> = {};
  kopf.forEach((k, i) => {
    const s = spalteAusKopf(k);
    if (s && spalte[s] === undefined) spalte[s] = i;
  });
  const kopfFehlt = [
    spalte.id === undefined ? AUFTRAG_SPALTEN[0] : null,
    spalte.leitung === undefined ? "Teamleitung" : null,
    spalte.helfer === undefined ? "Helfer" : null,
  ].filter((x): x is string => x !== null);
  if (kopfFehlt.length > 0) return { zeilen: [], kopfFehlt };

  const name = (id: string) => personen.find((p) => p.id === id)?.name ?? "?";
  const namenListe = (team: AnstehenderAuftrag["team"]) => {
    const lead = team.find((t) => t.role === "lead");
    return [...(lead ? [lead] : []), ...team.filter((t) => t !== lead)].map((t) => name(t.employeeId));
  };
  const gesehen = new Set<string>();
  const zeilen: TeamImportZeile[] = [];

  rest.forEach((r, i) => {
    const zelle = (s: "id" | "leitung" | "helfer") => (r[spalte[s]!] ?? "").trim();
    const nr = i + 2;
    const id = zelle("id");
    const leitungRoh = zelle("leitung");
    const helferRoh = zelle("helfer");
    const a = auftraege.find((x) => x.dealId === id);
    const z: TeamImportZeile = {
      nr,
      dealId: a ? a.dealId : id || null,
      titel: a?.titel ?? (r[4] ?? "").trim(),
      datum: a ? datumText(a.tag, a.bisTag) : (r[1] ?? "").trim(),
      art: "gleich",
      alt: a ? namenListe(a.team) : [],
      neu: [],
      team: [],
      fehler: [],
      hinweise: [],
      trotzdem: [],
    };
    zeilen.push(z);
    if (leitungRoh === "" && helferRoh === "") return; // nichts ändern
    if (!id) {
      z.art = "fehler";
      z.fehler.push("Ohne Auftrag-ID. Neue Aufträge bitte im CRM anlegen.");
      return;
    }
    if (!a) {
      z.art = "fehler";
      z.fehler.push("Diesen Auftrag gibt es nicht mehr oder er steht nicht mehr an.");
      return;
    }
    if (gesehen.has(a.dealId)) {
      z.art = "fehler";
      z.fehler.push("Dieser Auftrag steht doppelt in der Tabelle.");
      return;
    }
    gesehen.add(a.dealId);

    const bisher = new Set(a.team.map((t) => t.employeeId));
    const team: AnstehenderAuftrag["team"] = [];
    for (const [roh, rolle] of [
      ...namenAus(leitungRoh).map((x) => [x, "lead"] as const),
      ...namenAus(helferRoh).map((x) => [x, "helper"] as const),
    ]) {
      const t = personZumNamen(roh, personen);
      if ("fehler" in t) {
        z.fehler.push(t.fehler);
        continue;
      }
      if (!t.ok.aktiv && !bisher.has(t.ok.id)) {
        z.fehler.push(`${t.ok.name} ist nicht mehr aktiv.`);
        continue;
      }
      if (team.some((x) => x.employeeId === t.ok.id)) continue;
      team.push({ employeeId: t.ok.id, role: rolle });
    }
    if (namenAus(leitungRoh).length > 1) z.fehler.push("Bei Teamleitung bitte nur einen Namen.");
    // Wie im Einsatz-Dialog: leitet niemand, leitet die erste Person.
    if (team.length > 0 && !team.some((t) => t.role === "lead")) team[0] = { ...team[0]!, role: "lead" };
    z.team = team;
    z.neu = namenListe(team);
    if (z.fehler.length > 0) {
      z.art = "fehler";
      return;
    }
    const altLead = a.team.find((t) => t.role === "lead")?.employeeId ?? null;
    const neuLead = team.find((t) => t.role === "lead")?.employeeId ?? null;
    const gleich = team.length === a.team.length && team.every((t) => bisher.has(t.employeeId)) && altLead === neuLead;
    z.art = gleich ? "gleich" : "aendern";
  });

  // Doppelt am Tag: wer neu dazukommt und am selben Tag auf einem anderen Auftrag steht (nach dem Import).
  // Wer die Tabelle so ausfüllt, will das (zwei kurze Aufträge nacheinander): Hinweis, eingeteilt wird trotzdem.
  const nachher = (dealId: string) => {
    const z = zeilen.find((x) => x.dealId === dealId && x.art === "aendern");
    return z ? z.team.map((t) => t.employeeId) : (auftraege.find((x) => x.dealId === dealId)?.team ?? []).map((t) => t.employeeId);
  };
  for (const z of zeilen) {
    if (z.art !== "aendern") continue;
    const a = auftraege.find((x) => x.dealId === z.dealId)!;
    const bisher = new Set(a.team.map((t) => t.employeeId));
    for (const t of z.team) {
      if (bisher.has(t.employeeId)) continue;
      const andere = auftraege.filter((b) => b.dealId !== a.dealId && ueberlappt(a, b) && nachher(b.dealId).includes(t.employeeId));
      if (andere.length === 0) continue;
      z.hinweise.push(`${name(t.employeeId)} ist am selben Tag auch bei ${andere.map((b) => b.titel).join(", ")}.`);
      z.trotzdem.push(t.employeeId);
    }
  }
  return { zeilen, kopfFehlt };
}

/** Fehler aus „Team bestätigen“ beim Übernehmen. */
export const TEAM_FEHLER_TEXT: Record<string, string> = {
  DOPPELT_AM_TAG: "Jemand ist an dem Tag schon auf einem anderen Auftrag eingeteilt.",
  STEMPELT_NOCH: "Jemand ist für diesen Auftrag gerade eingestempelt und kann nicht entfernt werden.",
  INAKTIV: "Jemand im Team ist nicht mehr aktiv.",
  DOPPELTE_PERSON: "Eine Person steht doppelt im Team.",
};
