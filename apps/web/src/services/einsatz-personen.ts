/**
 * Stammdaten und Ausnahmen der Mitarbeiter für den Einsatz (Plan 12a).
 * PLZ und Ort verlassen diesen Dienst nur über `/api/v1/einsatz/*` und den
 * Einsatz-Dialog; nie über `listEmployees`, MCP, Portal oder Mitarbeiter-App.
 */
import { and, asc, eq, gte, lte } from "drizzle-orm";
import { db } from "@/db";
import { employeeAbsences, employees } from "@/db/schema";
import { kuerzelAus } from "@/lib/akte";
import type { Abwesenheit, AbwesenheitArt, EinsatzPerson } from "@/lib/einsatz";

export type DbExecutor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

type PersonZeile = Pick<
  typeof employees.$inferSelect,
  "id" | "name" | "active" | "homePlz" | "homeTown" | "canDriveSprinter" | "ownCar" | "rateDriveCents" | "rateWorkCents"
>;

export function personAus(z: PersonZeile): EinsatzPerson {
  const name = z.name?.trim() || "Ohne Namen";
  return {
    id: z.id,
    name,
    kuerzel: kuerzelAus(name),
    aktiv: z.active,
    plz: z.homePlz,
    wohnort: z.homeTown,
    kannSprinter: z.canDriveSprinter,
    eigenerPkw: z.ownCar,
    satzFahrtCent: z.rateDriveCents,
    satzArbeitCent: z.rateWorkCents,
  };
}

export const PERSON_SPALTEN = {
  id: employees.id,
  name: employees.name,
  active: employees.active,
  homePlz: employees.homePlz,
  homeTown: employees.homeTown,
  canDriveSprinter: employees.canDriveSprinter,
  ownCar: employees.ownCar,
  rateDriveCents: employees.rateDriveCents,
  rateWorkCents: employees.rateWorkCents,
} as const;

/** Alle Personen des Workspace (auch inaktive), nach Name. */
export async function ladePersonen(ws: string, ex: DbExecutor = db): Promise<EinsatzPerson[]> {
  const rows = await ex
    .select(PERSON_SPALTEN)
    .from(employees)
    .where(eq(employees.workspaceId, ws))
    .orderBy(asc(employees.name), asc(employees.id));
  return rows.map(personAus).sort((a, b) => a.name.localeCompare(b.name, "de") || a.id.localeCompare(b.id));
}

type AbwesenheitZeile = typeof employeeAbsences.$inferSelect;

export function abwesenheitAus(z: AbwesenheitZeile): Abwesenheit {
  return { id: z.id, employeeId: z.employeeId, von: z.von, bis: z.bis, art: z.art as AbwesenheitArt, notiz: z.notiz };
}

/** Ausnahmen, die das Fenster `von..bis` schneiden (inklusiv), nach Beginn. */
export async function ladeAbwesenheiten(ws: string, von: string, bis: string, ex: DbExecutor = db): Promise<Abwesenheit[]> {
  const rows = await ex
    .select()
    .from(employeeAbsences)
    .where(and(eq(employeeAbsences.workspaceId, ws), lte(employeeAbsences.von, bis), gte(employeeAbsences.bis, von)))
    .orderBy(asc(employeeAbsences.von), asc(employeeAbsences.id));
  return rows.map(abwesenheitAus);
}
