import { NextRequest } from "next/server";
import { badRequest, getAuthContext, success, unauthorized } from "@/lib/api-utils";
import { BOARD_SEITE, filterAusParams } from "@/lib/leads-board";
import { ladeLeadsSpalte, SPALTE_LIMIT_MAX } from "@/services/leads-board";

/** Ganze Zahl ab `min` aus einem Parameter; fehlt er, der Standard; sonst null (ungültig). */
function zahlParam(roh: string | null, standard: number, min: number): number | null {
  if (roh === null || roh.trim() === "") return standard;
  if (!/^\d+$/.test(roh.trim())) return null;
  const n = Number(roh.trim());
  return Number.isSafeInteger(n) && n >= min ? n : null;
}

/**
 * GET `?stufe=&offset=&limit=` + Filter → `{ data: LeadsSpaltenSeite }`:
 * „Mehr laden“ einer Spalte (Stufen-ID oder `_ohne`), und Neu laden mit der
 * schon geladenen Kartenzahl als `limit` (höchstens 400, darüber gekappt).
 * Ohne `stufe` oder mit ungültigem `offset`/`limit` 400. Liest nur.
 */
export async function GET(req: NextRequest) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized(req);

  const p = req.nextUrl.searchParams;
  const stufe = (p.get("stufe") ?? "").trim();
  if (!stufe) return badRequest("Parameter „stufe“ fehlt.");
  const offset = zahlParam(p.get("offset"), 0, 0);
  if (offset === null) return badRequest("Parameter „offset“ ist ungültig.");
  const limit = zahlParam(p.get("limit"), BOARD_SEITE, 1);
  if (limit === null) return badRequest("Parameter „limit“ ist ungültig.");

  return success(
    await ladeLeadsSpalte(ctx.workspaceId, filterAusParams(p), stufe, offset, Math.min(limit, SPALTE_LIMIT_MAX)),
  );
}
