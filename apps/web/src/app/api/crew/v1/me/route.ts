/**
 * Crew-API v1 `/me` (Vertrag docs/API-CONTRACT.md). Nur Server zu Server:
 * `X-Crew-Secret` und `X-Crew-Token`, keine Sitzung, kein CORS.
 * GET → `CrewMe`; PATCH `{ locale }` → `CrewMe`.
 */
import type { NextRequest } from "next/server";
import { z } from "zod";
import { crewFehler, crewJson, crewOk } from "@/lib/crew/antwort";
import { CrewLocale } from "@/lib/crew/contract";
import { requireCrew } from "@/services/crew/auth";
import { crewMeAus, crewSpracheSetzen } from "@/services/crew/me";

export const dynamic = "force-dynamic";

const PatchBody = z.object({ locale: CrewLocale });

export async function GET(req: NextRequest) {
  const a = await requireCrew(req);
  if (!a.ok) return a.antwort;
  return crewOk(crewMeAus(a.k));
}

export async function PATCH(req: NextRequest) {
  const a = await requireCrew(req);
  if (!a.ok) return a.antwort;
  const body = PatchBody.safeParse(await crewJson(req));
  if (!body.success) return crewFehler("UNGUELTIG", "Body: { locale: de|en|tr|ar|pl|uk|ru }");
  return crewOk(await crewSpracheSetzen(a.k, body.data.locale));
}
