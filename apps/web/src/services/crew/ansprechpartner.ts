/**
 * Ansprechpartner je Job: wen das bestätigte Team bei Fragen anruft. Je Deal
 * eingetragen (`crew_ansprechpartner`), sonst der Standard des Workspaces
 * (`workspace_settings.crew_ansprechpartner`, eine Mitarbeiter-ID). Nur aktive
 * Personen mit Telefonnummer zählen; sonst gibt es keinen.
 */
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { crewAnsprechpartner, employees } from "@/db/schema";
import { vornameAus } from "@/lib/crew/logik";
import { zeilen } from "@/lib/db-werte";
import type { DbExecutor } from "@/services/einsatz-personen";
import { getSetting, setSetting } from "@/services/workspace-settings";

export const STANDARD_SCHLUESSEL = "crew_ansprechpartner";

const liste = (ids: readonly string[]) => sql`${sql.param([...ids])}::text[]`;

/** Was die Crew sieht: Vorname und Nummer. */
export interface CrewKontakt {
  employeeId: string;
  firstName: string;
  phone: string;
}

/** Ansprechpartner je Deal (eingetragen, sonst Standard); nur aktive mit Telefon. */
export async function ansprechpartnerFuer(ex: DbExecutor, ws: string, dealIds: string[]): Promise<Map<string, CrewKontakt>> {
  if (dealIds.length === 0) return new Map();
  const rows = zeilen<{ deal: string; id: string; name: string; phone: string }>(
    await ex.execute(sql`
      WITH std AS (SELECT value_plain AS id FROM workspace_settings WHERE workspace_id = ${ws} AND key = ${STANDARD_SCHLUESSEL} AND is_secret = false)
      SELECT d.deal, e.id, e.name, e.phone_canonical AS phone
      FROM unnest(${liste(dealIds)}) AS d(deal)
      LEFT JOIN crew_ansprechpartner ca ON ca.deal_record_id = d.deal AND ca.workspace_id = ${ws}
      INNER JOIN employees e ON e.id = COALESCE(ca.employee_id, (SELECT id FROM std)) AND e.workspace_id = ${ws}
      WHERE e.active = true AND e.phone_canonical IS NOT NULL
    `),
  );
  return new Map(rows.map((z) => [z.deal, { employeeId: z.id, firstName: vornameAus(z.name), phone: z.phone }]));
}

export interface AnsprechpartnerAnsicht {
  /** Für diesen Job eingetragen; null = es gilt der Standard. */
  eingetragen: string | null;
  standard: string | null;
  /** Wer gerade gilt (eingetragen oder Standard), nur wenn aktiv mit Telefon. */
  gilt: { employeeId: string; name: string } | null;
  /** Wählbar: aktive Mitarbeiter mit Telefon. */
  kandidaten: Array<{ employeeId: string; name: string }>;
}

export async function ansprechpartnerAnsicht(ws: string, deal: string): Promise<AnsprechpartnerAnsicht> {
  const [eingetragen] = await db
    .select({ id: crewAnsprechpartner.employeeId })
    .from(crewAnsprechpartner)
    .where(and(eq(crewAnsprechpartner.dealRecordId, deal), eq(crewAnsprechpartner.workspaceId, ws)))
    .limit(1);
  const standard = await getSetting(ws, STANDARD_SCHLUESSEL);
  const kandidaten = zeilen<{ id: string; name: string }>(
    await db.execute(sql`
      SELECT id, name FROM employees
      WHERE workspace_id = ${ws} AND active = true AND phone_canonical IS NOT NULL
      ORDER BY lower(name), id
    `),
  ).map((z) => ({ employeeId: z.id, name: z.name }));
  const giltId = eingetragen?.id ?? standard;
  const gilt = kandidaten.find((k) => k.employeeId === giltId) ?? null;
  return { eingetragen: eingetragen?.id ?? null, standard, gilt, kandidaten };
}

export type SetzenErgebnis = { ok: true; wert: AnsprechpartnerAnsicht } | { ok: false; code: "UNGUELTIG" };

/**
 * Setzt den Ansprechpartner für diesen Job (null = wieder der Standard) und
 * auf Wunsch zugleich als Standard für alle Jobs. Nur aktive mit Telefon.
 */
export async function ansprechpartnerSetzen(
  ws: string,
  deal: string,
  o: { employeeId: string | null; alsStandard?: boolean },
  autor: string,
): Promise<SetzenErgebnis> {
  if (o.employeeId !== null) {
    const [p] = await db
      .select({ id: employees.id })
      .from(employees)
      .where(and(eq(employees.id, o.employeeId), eq(employees.workspaceId, ws), eq(employees.active, true), sql`${employees.phoneCanonical} IS NOT NULL`))
      .limit(1);
    if (!p) return { ok: false, code: "UNGUELTIG" };
  }
  if (o.alsStandard) {
    if (o.employeeId === null) return { ok: false, code: "UNGUELTIG" };
    await setSetting(ws, STANDARD_SCHLUESSEL, o.employeeId);
    // Wer Standard ist, braucht am Job keinen eigenen Eintrag.
    await db.delete(crewAnsprechpartner).where(and(eq(crewAnsprechpartner.dealRecordId, deal), eq(crewAnsprechpartner.workspaceId, ws)));
  } else if (o.employeeId === null) {
    await db.delete(crewAnsprechpartner).where(and(eq(crewAnsprechpartner.dealRecordId, deal), eq(crewAnsprechpartner.workspaceId, ws)));
  } else {
    await db
      .insert(crewAnsprechpartner)
      .values({ dealRecordId: deal, workspaceId: ws, employeeId: o.employeeId, setBy: autor })
      .onConflictDoUpdate({ target: crewAnsprechpartner.dealRecordId, set: { employeeId: o.employeeId, setBy: autor, setAt: new Date() } });
  }
  return { ok: true, wert: await ansprechpartnerAnsicht(ws, deal) };
}
