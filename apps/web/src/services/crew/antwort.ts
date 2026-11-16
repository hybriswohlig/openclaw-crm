/**
 * Antwort auf einen Job (Vertrag „Answer semantics“). „ja“ ist eine Anfrage in
 * `crew_job_responses`, nie ein Eintrag in `deal_employees`; das bestätigt nur
 * das CRM (Einsatz-Dialog). Transaktion mit derselben Sperre je Deal wie
 * „Team bestätigen“ (`einsatz:deal:<id>`), damit Antwort und Bestätigung
 * einander sehen: wer gerade bestätigt wird, bekommt 409.
 */
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { crewJobResponses, dealEmployees, employees } from "@/db/schema";
import type { CrewJob } from "@/lib/crew/contract";
import { antwortEntscheiden, istVoll, type PortalAntwort } from "@/lib/crew/logik";
import type { CrewKontext } from "./auth";
import { ladeCrewJobs, ladeCrewJobsIntern } from "./jobs";

export type AntwortErgebnis =
  | { ok: true; job: CrewJob }
  | { ok: false; code: "JOB_NICHT_SICHTBAR" | "BEREITS_BESTAETIGT" };

class Abbruch extends Error {
  constructor(readonly code: "BEREITS_BESTAETIGT") {
    super(code);
  }
}

export async function antwortSetzen(
  k: CrewKontext,
  dealId: string,
  antwort: PortalAntwort,
  o: { jetzt?: Date } = {},
): Promise<AntwortErgebnis> {
  const jetzt = o.jetzt ?? new Date();
  const [vorher] = await ladeCrewJobsIntern(k, { dealIds: [dealId], jetzt });
  if (!vorher) return { ok: false, code: "JOB_NICHT_SICHTBAR" };
  const ich = k.employee.id;

  try {
    await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`einsatz:deal:${dealId}`}, 0))`);
      // In der Sperre frisch gelesen: eingeteilt? wie viele bestätigt?
      const team = await tx
        .select({ employeeId: dealEmployees.employeeId })
        .from(dealEmployees)
        .innerJoin(employees, and(eq(employees.id, dealEmployees.employeeId), eq(employees.workspaceId, k.workspaceId)))
        .where(eq(dealEmployees.dealRecordId, dealId));
      const e = antwortEntscheiden({
        antwort,
        zugeteilt: team.some((t) => t.employeeId === ich),
        voll: istVoll(team.length, vorher.workerCount),
      });
      if (e.art === "fehler") throw new Abbruch(e.code);
      if (e.art === "loeschen") {
        await tx
          .delete(crewJobResponses)
          .where(and(eq(crewJobResponses.dealRecordId, dealId), eq(crewJobResponses.employeeId, ich), eq(crewJobResponses.workspaceId, k.workspaceId)));
        return;
      }
      await tx
        .insert(crewJobResponses)
        .values({ workspaceId: k.workspaceId, dealRecordId: dealId, employeeId: ich, answer: e.answer, answeredAt: jetzt, updatedAt: jetzt, source: "portal" })
        .onConflictDoUpdate({
          target: [crewJobResponses.dealRecordId, crewJobResponses.employeeId],
          set: {
            answer: e.answer,
            // Zeitpunkt der Antwort nur bei echter Änderung (gleiche Antwort zweimal bleibt alt).
            answeredAt: sql`CASE WHEN ${crewJobResponses.answer} = ${e.answer} THEN ${crewJobResponses.answeredAt} ELSE ${jetzt.toISOString()}::timestamptz END`,
            updatedAt: jetzt,
            source: "portal",
          },
        });
    });
  } catch (err) {
    if (err instanceof Abbruch) return { ok: false, code: err.code };
    throw err;
  }

  // Frisch aus der ganzen Liste, damit „Konflikt am Tag“ stimmt.
  const nachher = (await ladeCrewJobs(k, { jetzt })).find((j) => j.id === dealId);
  if (nachher) return { ok: true, job: nachher };
  // Nur über die eigene Antwort sichtbar gewesen und zurückgenommen: letzter Stand, jetzt offen.
  return { ok: true, job: { ...vorher.job, my: { status: "offen", answeredAt: null }, conflictSameDay: false } };
}
