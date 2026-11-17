/**
 * Crew-API v1 `POST /jobs/:dealId/briefing/gelesen` → `{ readAt }`. Gilt für die
 * aktuelle Freigabe; nach „Erneut freigeben“ ist das Briefing wieder neu.
 */
import type { NextRequest } from "next/server";
import { crewFehler, crewOk } from "@/lib/crew/antwort";
import { requireCrew } from "@/services/crew/auth";
import { briefingGelesen } from "@/services/crew/briefing";

export const dynamic = "force-dynamic";

const DEAL_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

export async function POST(req: NextRequest, { params }: { params: Promise<{ dealId: string }> }) {
  const a = await requireCrew(req);
  if (!a.ok) return a.antwort;
  const { dealId } = await params;
  if (!DEAL_ID_RE.test(dealId)) return crewFehler("JOB_NICHT_SICHTBAR");
  const r = await briefingGelesen(a.k, dealId);
  if (!r.ok) return crewFehler(r.code);
  return crewOk({ readAt: r.readAt });
}
