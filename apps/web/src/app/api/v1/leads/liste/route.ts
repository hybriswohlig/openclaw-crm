import { NextRequest } from "next/server";
import { badRequest, getAuthContext, success, unauthorized } from "@/lib/api-utils";
import { filterAusParams, sortierungAusParams, STANDARD_ANSICHT } from "@/lib/leads-board";
import { ladeLeadsListe } from "@/services/leads-board";

/**
 * GET `?sort=&richtung=&offset=` + Filter → `{ data: LeadsListe }` (Plan 7,
 * Entscheidung 15): 50 Zeilen je Seite, `gesamt` über alle Seiten, Chips
 * ungefiltert. Ohne gültige Sortierung gilt `STANDARD_ANSICHT.sortierung`
 * (Wartezeit, längste oben); Verloren und Kein Lead nur mit `alle=1`.
 * Ungültiger `offset` 400. Liest nur.
 */
export async function GET(req: NextRequest) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized(req);

  const p = req.nextUrl.searchParams;
  const offsetRoh = (p.get("offset") ?? "").trim();
  if (offsetRoh !== "" && !/^\d+$/.test(offsetRoh)) return badRequest("Parameter „offset“ ist ungültig.");
  const offset = offsetRoh === "" ? 0 : Number(offsetRoh);
  if (!Number.isSafeInteger(offset)) return badRequest("Parameter „offset“ ist ungültig.");

  return success(
    await ladeLeadsListe(
      ctx.workspaceId,
      filterAusParams(p),
      sortierungAusParams(p, STANDARD_ANSICHT.sortierung),
      offset,
    ),
  );
}
