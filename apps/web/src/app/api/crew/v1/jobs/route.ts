/**
 * Crew-API v1 `GET /jobs`: offene Jobs (Regel A) und meine Jobs (Regel B),
 * nach Datum und Startzeit. Antwort `{ jobs: CrewJob[], serverTime }`.
 */
import type { NextRequest } from "next/server";
import { crewOk } from "@/lib/crew/antwort";
import type { CrewJobsResponse } from "@/lib/crew/contract";
import { requireCrew } from "@/services/crew/auth";
import { ladeCrewJobs } from "@/services/crew/jobs";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const a = await requireCrew(req);
  if (!a.ok) return a.antwort;
  const jetzt = new Date();
  const antwort: CrewJobsResponse = { jobs: await ladeCrewJobs(a.k, { jetzt }), serverTime: jetzt.toISOString() };
  return crewOk(antwort);
}
