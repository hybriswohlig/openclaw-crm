/**
 * Crew-API v1 `POST /jobs/:dealId/antwort` mit `{ answer: ja|vielleicht|nein|null }`.
 * „ja“ ist eine Anfrage (voll → warteliste), null nimmt zurück. Eingeteilte
 * bekommen 409 BEREITS_BESTAETIGT. Antwort `{ job: CrewJob }`.
 */
import type { NextRequest } from "next/server";
import { crewFehler, crewJson, crewOk } from "@/lib/crew/antwort";
import { CrewAnswerBody } from "@/lib/crew/contract";
import { requireCrew } from "@/services/crew/auth";
import { antwortSetzen } from "@/services/crew/antwort";

export const dynamic = "force-dynamic";

const DEAL_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

export async function POST(req: NextRequest, { params }: { params: Promise<{ dealId: string }> }) {
  const a = await requireCrew(req);
  if (!a.ok) return a.antwort;
  const { dealId } = await params;
  if (!DEAL_ID_RE.test(dealId)) return crewFehler("JOB_NICHT_SICHTBAR");
  const body = CrewAnswerBody.safeParse(await crewJson(req));
  if (!body.success) return crewFehler("UNGUELTIG", "Body: { answer: ja|vielleicht|nein|null }");
  const r = await antwortSetzen(a.k, dealId, body.data.answer);
  if (!r.ok) return crewFehler(r.code);
  return crewOk({ job: r.job });
}
