/**
 * Crew-API v1 `POST /jobs/:dealId/briefing/gelesen` mit `{ releasedAt }` (die
 * Fassung, die die Person gesehen hat) → `{ readAt }`. Ist inzwischen neu
 * freigegeben, 409 BRIEFING_VERALTET; nach „Erneut freigeben“ ist es wieder neu.
 */
import type { NextRequest } from "next/server";
import { crewFehler, crewJson, crewOk } from "@/lib/crew/antwort";
import { CrewBriefingReadBody } from "@/lib/crew/contract";
import { requireCrew } from "@/services/crew/auth";
import { briefingGelesen } from "@/services/crew/briefing";

export const dynamic = "force-dynamic";

const DEAL_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

export async function POST(req: NextRequest, { params }: { params: Promise<{ dealId: string }> }) {
  const a = await requireCrew(req);
  if (!a.ok) return a.antwort;
  const { dealId } = await params;
  if (!DEAL_ID_RE.test(dealId)) return crewFehler("JOB_NICHT_SICHTBAR");
  const body = CrewBriefingReadBody.safeParse(await crewJson(req));
  if (!body.success || Number.isNaN(Date.parse(body.data.releasedAt))) return crewFehler("UNGUELTIG", "Body: { releasedAt }");
  const r = await briefingGelesen(a.k, dealId, body.data.releasedAt);
  if (!r.ok) return crewFehler(r.code);
  return crewOk({ readAt: r.readAt });
}
