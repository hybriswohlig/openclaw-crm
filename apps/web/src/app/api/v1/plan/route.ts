import { NextRequest } from "next/server";
import { badRequest, getAuthContext, success, unauthorized } from "@/lib/api-utils";
import { planAbfrageAusParams, planFuerApiSchluessel } from "@/lib/plan-heute";
import { ladePlan } from "@/services/plan";

/**
 * GET `?von&bis[&firma][&ma][&leads=1&chip&quelle&q&nur&alle]` →
 * `{ data: PlanAntwort }` (Plan 8). `von`/`bis` Pflicht, höchstens 62 Tage;
 * sonst 400 mit dem Text aus `planAbfrageAusParams`. Liest nur. API-Schlüssel
 * sehen Abwesenheit ohne Art und keine Transporter-Buchungen (Plan 12, M2).
 */
export async function GET(req: NextRequest) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized(req);

  const abfrage = planAbfrageAusParams(req.nextUrl.searchParams);
  if ("fehler" in abfrage) return badRequest(abfrage.fehler);

  const antwort = await ladePlan(ctx.workspaceId, abfrage);
  // Review M2: Abwesenheitsart und Buchungen (Miete) nur für Menschen mit Sitzung.
  return success(ctx.authMethod === "api_key" ? planFuerApiSchluessel(antwort) : antwort);
}
