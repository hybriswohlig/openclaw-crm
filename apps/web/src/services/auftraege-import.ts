/**
 * Auftrags-Tabelle (Inhaber 19.11.): anstehende feste Umzüge mit Team als CSV,
 * ausgefüllt zurück, Vorschau, dann übernehmen. Gespeichert wird über „Team
 * bestätigen“ (`einsatzBestaetigen`) mit denselben Sperren und Prüfungen;
 * Minuten wie im Einsatz-Dialog. Beim Import geht keine WhatsApp raus.
 */
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { dealEmployees, employees } from "@/db/schema";
import {
  auswahlEntfernen,
  auswahlHinzufuegen,
  leitungSetzen,
  startAuswahl,
  teamBody,
  type Auswahl,
} from "@/components/neu/einsatz/einsatz-logik";
import { teamImportPlan, TEAM_FEHLER_TEXT, type AnstehenderAuftrag, type TeamImportZeile } from "@/lib/auftraege-csv";
import { berlinDateString } from "@/lib/berlin-date";
import { istFest, type TeamRolle } from "@/lib/einsatz";
import { csvLesen } from "@/lib/mitarbeiter-csv";
import { einsatzBestaetigen, festeEinsaetze, massgeblicheVersion, rechnerDatenAus, zuteilungenLesen } from "./einsatz";
import { ladePersonen } from "./einsatz-personen";
import type { RechnerAnfrage } from "./rechner/eingabe";
import type { RechnerErgebnis } from "./rechner/client";

export const AUFTRAEGE_MAX_ZEICHEN = 500_000;

function tagPlus(tag: string, n: number): string {
  const [j, m, d] = tag.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(j, m - 1, d + n)).toISOString().slice(0, 10);
}

/** Feste Umzüge, die heute oder später (bis in einem Jahr) noch laufen, mit Team und Rollen. */
export async function anstehendeAuftraege(ws: string, jetzt: Date = new Date()): Promise<AnstehenderAuftrag[]> {
  const heute = berlinDateString(jetzt);
  const { eintraege } = await festeEinsaetze(ws, heute, tagPlus(heute, 365));
  const je = new Map<string, AnstehenderAuftrag>();
  for (const e of eintraege) {
    if (!istFest(e) || e.bisTag < heute) continue;
    const da = je.get(e.dealId);
    if (da) {
      if (e.tag < da.tag) da.tag = e.tag;
      if (e.bisTag > da.bisTag) da.bisTag = e.bisTag;
      continue;
    }
    je.set(e.dealId, {
      dealId: e.dealId,
      tag: e.tag,
      bisTag: e.bisTag,
      von: e.von,
      firma: e.firma?.name ?? null,
      titel: e.titel,
      strecke: e.strecke,
      team: [],
    });
  }
  const ids = [...je.keys()];
  if (ids.length > 0) {
    const rows = await db
      .select({ dealId: dealEmployees.dealRecordId, employeeId: dealEmployees.employeeId, role: dealEmployees.role })
      .from(dealEmployees)
      .innerJoin(employees, and(eq(employees.id, dealEmployees.employeeId), eq(employees.workspaceId, ws)))
      .where(inArray(dealEmployees.dealRecordId, ids))
      .orderBy(dealEmployees.createdAt, dealEmployees.id);
    for (const r of rows) {
      je.get(r.dealId)?.team.push({ employeeId: r.employeeId, role: (r.role === "lead" ? "lead" : "helper") as TeamRolle });
    }
  }
  return [...je.values()];
}

/**
 * Team eines Deals auf `wunsch` setzen, Minuten wie im Einsatz-Dialog: vom
 * heutigen Team aus Personen entfernen und hinzufügen (Minuten verteilen sich
 * neu, von Hand gesetzte bleiben), dann die Leitung setzen.
 */
async function teamSetzen(ws: string, deal: string, wunsch: AnstehenderAuftrag["team"], autor: string, trotzdem: string[] = []) {
  const [alt, v] = await Promise.all([zuteilungenLesen(ws, deal), massgeblicheVersion(ws, deal)]);
  const rechner = v ? rechnerDatenAus((v.rechnerRequest ?? null) as RechnerAnfrage | null, (v.rechnerResult ?? null) as RechnerErgebnis | null) : null;
  let s: Auswahl =
    alt.length > 0 ? startAuswahl({ team: alt, teamVorschlag: { team: [], fehlen: 0, hinweise: [] }, rechner }) : { team: [], bestaetigtAmTag: [] };
  for (const t of [...s.team]) if (!wunsch.some((w) => w.employeeId === t.employeeId)) s = auswahlEntfernen(s, t.employeeId, rechner);
  for (const w of wunsch) s = auswahlHinzufuegen(s, w.employeeId, rechner);
  const lead = wunsch.find((w) => w.role === "lead");
  if (lead) s = leitungSetzen(s, lead.employeeId);
  const body = teamBody(s);
  const erlaubt = trotzdem.filter((id) => body.team.some((t) => t.employeeId === id));
  return einsatzBestaetigen(ws, deal, erlaubt.length > 0 ? { team: body.team, bestaetigtAmTag: erlaubt } : { team: body.team }, autor);
}

export interface AuftraegeImportErgebnis {
  zeilen: TeamImportZeile[];
  kopfFehlt: string[];
  uebernommen: number;
}

export async function auftraegeImport(ws: string, csv: string, uebernehmen: boolean, autor: string): Promise<AuftraegeImportErgebnis> {
  const [auftraege, personen] = await Promise.all([anstehendeAuftraege(ws), ladePersonen(ws)]);
  const plan = teamImportPlan(csvLesen(csv), auftraege, personen);
  if (!uebernehmen || plan.kopfFehlt.length > 0) return { ...plan, uebernommen: 0 };
  const aendern = plan.zeilen.filter((z) => z.art === "aendern");
  const altTeam = (deal: string) => auftraege.find((a) => a.dealId === deal)?.team ?? [];

  // Erst wer den Auftrag wechselt, vom alten Auftrag nehmen; sonst meldet der neue „schon eingeteilt“.
  const kommtHinzu = new Set(aendern.flatMap((z) => z.team.filter((t) => !altTeam(z.dealId!).some((a) => a.employeeId === t.employeeId)).map((t) => t.employeeId)));
  for (const z of aendern) {
    const alt = altTeam(z.dealId!);
    const wechselt = alt.filter((t) => kommtHinzu.has(t.employeeId) && !z.team.some((n) => n.employeeId === t.employeeId));
    if (wechselt.length === 0) continue;
    const r = await teamSetzen(ws, z.dealId!, alt.filter((t) => !wechselt.includes(t)), autor).catch(() => null);
    if (!r?.ok) {
      z.art = "fehler";
      z.fehler.push(r ? (TEAM_FEHLER_TEXT[r.code] ?? "Nicht gespeichert.") : "Nicht gespeichert, bitte noch einmal versuchen.");
    }
  }

  let uebernommen = 0;
  for (const z of aendern) {
    if (z.art !== "aendern") continue;
    try {
      const r = await teamSetzen(ws, z.dealId!, z.team, autor, z.trotzdem);
      if (r.ok) uebernommen++;
      else {
        z.art = "fehler";
        z.fehler.push(TEAM_FEHLER_TEXT[r.code] ?? "Nicht gespeichert.");
      }
    } catch (err) {
      z.art = "fehler";
      z.fehler.push("Nicht gespeichert, bitte noch einmal versuchen.");
      console.error("[auftraege-import]", err instanceof Error ? err.message : String(err));
    }
  }
  return { ...plan, uebernommen };
}
