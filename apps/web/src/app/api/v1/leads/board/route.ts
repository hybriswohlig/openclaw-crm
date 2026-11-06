import { NextRequest } from "next/server";
import { getAuthContext, success, unauthorized } from "@/lib/api-utils";
import { filterAusParams } from "@/lib/leads-board";
import { ladeLeadsBoard } from "@/services/leads-board";

/**
 * GET → `{ data: LeadsBoard }` (Plan 7): Spalten je aktiver Stufe mit der
 * ersten Seite Karten, Anzahl und Summe über die ganze gefilterte Spalte,
 * Chips „Heute im Blick“ ungefiltert, dazu Firmen, Quellen, Stufen und
 * Verlustgründe. Filter: `chip`, `firma`, `quelle`, `monat`, `q`, `nur=uns`,
 * `alle=1` (`filterAusParams`). Liest nur, auch für Nur-Lesen-Schlüssel.
 */
export async function GET(req: NextRequest) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized(req);
  return success(await ladeLeadsBoard(ctx.workspaceId, filterAusParams(req.nextUrl.searchParams)));
}
