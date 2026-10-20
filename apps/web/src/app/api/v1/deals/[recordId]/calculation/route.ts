import { NextRequest } from "next/server";
import { getAuthContext, isReadOnlyApiKey, unauthorized, success } from "@/lib/api-utils";
import { ensureDealCalculation } from "@/services/rechner/kalkulation";
import { dbSpeicher } from "@/services/rechner/speicher";

/**
 * Kalkulation des Angebotsrechners für diesen Lead.
 * GET  → rechnet nur, wenn sich die Eingabe geändert hat (und nicht gedrosselt), liefert die Kalkulation.
 * POST → rechnet erzwungen neu ("Neu kalkulieren").
 * Fehler im Rechner oder beim Laden brechen die Seite nie: dann kommt die letzte
 * gespeicherte Kalkulation mit Status "fehler".
 */
async function kalkulation(req: NextRequest, params: Promise<{ recordId: string }>, force: boolean) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized(req);
  const { recordId } = await params;
  // GET recalculates and stores when the input changed. A read-only key only
  // receives the stored row and does not call the calculator or write.
  if (!force && isReadOnlyApiKey(ctx)) {
    const gespeichert = await dbSpeicher.lesen(recordId);
    const sichtbar =
      gespeichert?.workspaceId === ctx.workspaceId ? gespeichert : null;
    return success({ status: "unveraendert" as const, kalkulation: sichtbar });
  }
  try {
    return success(await ensureDealCalculation(ctx.workspaceId, recordId, { force }));
  } catch (e) {
    console.error("[kalkulation] Lead", recordId, e);
    const vorher = await dbSpeicher.lesen(recordId).catch(() => null);
    return success({ status: "fehler" as const, kalkulation: vorher?.workspaceId === ctx.workspaceId ? vorher : null });
  }
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ recordId: string }> }) {
  return kalkulation(req, params, false);
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ recordId: string }> }) {
  return kalkulation(req, params, true);
}
