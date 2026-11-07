import { NextRequest, NextResponse } from "next/server";
import { requireCronAuth } from "@/lib/cron-auth";
import { RENDER_JOB_RESERVIERUNG_MS } from "@/lib/angebot-wahl";
import { jobsAbgelaufenMarkieren, offeneJobs } from "@/services/render-jobs";
import { kvJobAbschliessen } from "@/services/kv-job-abschluss";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Höchstens so viele Jobs je Lauf (läuft jede Minute). */
const JE_LAUF = 25;

/**
 * Legt fertige VPS-Dokumente ab, auch wenn der Bediener den Browser schon
 * geschlossen hat (Plan 5a, Entscheidung 7). Erst Jobs älter als 24 h auf
 * „fehler“, dann offene KV-Jobs über dieselbe Stelle wie der Browser
 * (`kvJobAbschliessen`, mit Reservierung). Jeder Job läuft mit seinem
 * eigenen Workspace.
 */
export async function GET(req: NextRequest) {
  const denied = requireCronAuth(req);
  if (denied) return denied;

  const jetzt = new Date();
  const abgelaufen = await jobsAbgelaufenMarkieren(jetzt);
  // Nur KVs (K3). Rechnung und AB legen Browser oder MCP ab, mit ihrem Fälligkeitsdatum;
  // nach 24 h setzt jobsAbgelaufenMarkieren auch sie auf „fehler“.
  const jobs = await offeneJobs(new Date(jetzt.getTime() - RENDER_JOB_RESERVIERUNG_MS), JE_LAUF, "quotation");

  const zaehler: Record<string, number> = {};
  for (const job of jobs) {
    let status: string;
    try {
      status = (await kvJobAbschliessen(job.workspaceId, job.vpsJobId, { jetzt })).status;
    } catch (err) {
      console.error("[cron/render-jobs]", job.vpsJobId, err);
      status = "ausnahme";
    }
    zaehler[status] = (zaehler[status] ?? 0) + 1;
  }

  return NextResponse.json({ ok: true, abgelaufen, geprueft: jobs.length, ...zaehler });
}
