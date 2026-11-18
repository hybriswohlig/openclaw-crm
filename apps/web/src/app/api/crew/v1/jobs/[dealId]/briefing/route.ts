/**
 * Crew-API v1 `GET /jobs/:dealId/briefing` → `{ briefing: CrewBriefing }`.
 * Nur für eingeteilte Personen (sonst 404 JOB_NICHT_SICHTBAR) und erst nach der
 * Freigabe im Einsatz-Dialog (sonst 404 BRIEFING_NICHT_FREI).
 */
import type { NextRequest } from "next/server";
import { crewFehler, crewOk } from "@/lib/crew/antwort";
import { requireCrew } from "@/services/crew/auth";
import { briefingLesen } from "@/services/crew/briefing";

export const dynamic = "force-dynamic";

const DEAL_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

export async function GET(req: NextRequest, { params }: { params: Promise<{ dealId: string }> }) {
  const a = await requireCrew(req);
  if (!a.ok) return a.antwort;
  const { dealId } = await params;
  if (!DEAL_ID_RE.test(dealId)) return crewFehler("JOB_NICHT_SICHTBAR");
  const r = await briefingLesen(a.k, dealId);
  if (!r.ok) return crewFehler(r.code);
  return crewOk({ briefing: r.briefing });
}
