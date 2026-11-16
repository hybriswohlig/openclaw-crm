/** `/me` der Crew-API: wer ich bin, ohne Telefon, Sätze oder Wohnort. */
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { employees } from "@/db/schema";
import type { CrewLocale, CrewMe } from "@/lib/crew/contract";
import { farbeAus, initialenAus, vornameAus } from "@/lib/crew/logik";
import type { CrewKontext } from "./auth";

export function crewMeAus(k: CrewKontext): CrewMe {
  return {
    employee: {
      id: k.employee.id,
      firstName: vornameAus(k.employee.name),
      initials: initialenAus(k.employee.name),
      locale: k.employee.locale,
      canDriveSprinter: k.employee.canDriveSprinter,
      color: farbeAus(k.employee.id),
    },
  };
}

/** Sprache aus dem Portal setzen (gleiches Feld wie im CRM). */
export async function crewSpracheSetzen(k: CrewKontext, locale: CrewLocale): Promise<CrewMe> {
  await db
    .update(employees)
    .set({ locale, updatedAt: new Date() })
    .where(and(eq(employees.id, k.employee.id), eq(employees.workspaceId, k.workspaceId)));
  return crewMeAus({ ...k, employee: { ...k.employee, locale } });
}
