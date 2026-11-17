/**
 * Antwort auf einen Job (Vertrag „Answer semantics“). „ja“ ist eine Anfrage in
 * `crew_job_responses`, nie ein Eintrag in `deal_employees`; das bestätigt nur
 * das CRM (Einsatz-Dialog). Transaktion mit derselben Sperre je Deal wie
 * „Team bestätigen“ (`einsatz:deal:<id>`). Unter der Sperre frisch gelesen:
 * Sichtbarkeit (Regeln A und B), `worker_count` und die Zahl der Bestätigten.
 * Wer gerade bestätigt wird, bekommt 409; ein gerade zurückgezogener Job 404.
 */
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { crewJobResponses, dealEmployees, employees } from "@/db/schema";
import type { CrewJob } from "@/lib/crew/contract";
import { antwortEntscheiden, istVoll, type PortalAntwort } from "@/lib/crew/logik";
import type { CrewKontext } from "./auth";
import { dealSichtbar, ladeCrewJobs } from "./jobs";

export type AntwortErgebnis =
  | { ok: true; job: CrewJob }
  | { ok: false; code: "JOB_NICHT_SICHTBAR" | "BEREITS_BESTAETIGT" };

class Abbruch extends Error {
  constructor(readonly code: "BEREITS_BESTAETIGT" | "JOB_NICHT_SICHTBAR") {
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
  const ich = k.employee.id;

  try {
    await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`einsatz:deal:${dealId}`}, 0))`);
      const grund = await dealSichtbar(k, dealId, { jetzt, ex: tx });
      if (!grund) throw new Abbruch("JOB_NICHT_SICHTBAR");
      const team = await tx
        .select({ employeeId: dealEmployees.employeeId })
        .from(dealEmployees)
        .innerJoin(employees, and(eq(employees.id, dealEmployees.employeeId), eq(employees.workspaceId, k.workspaceId)))
        .where(eq(dealEmployees.dealRecordId, dealId));
      const e = antwortEntscheiden({
        antwort,
        zugeteilt: team.some((t) => t.employeeId === ich),
        // Unsicher (noch nicht gebucht): keine Warteliste, „ja“ heißt „hätte Zeit“ und wird bei Buchung Anfrage.
        voll: grund.fix && istVoll(team.length, grund.workerCount),
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

  // Nur diesen Job neu bauen (Konflikt am Tag zählt gegen die eigenen Jobs).
  const [job] = await ladeCrewJobs(k, { dealIds: [dealId], jetzt });
  if (job) return { ok: true, job };
  // Nur über die eigene Antwort sichtbar gewesen und gerade zurückgenommen: Stand ohne Antwort.
  const [ohne] = await ladeCrewJobs(k, { dealIds: [dealId], erzwingen: dealId, jetzt });
  if (ohne) return { ok: true, job: ohne };
  return { ok: false, code: "JOB_NICHT_SICHTBAR" };
}
