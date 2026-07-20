import { NextRequest, NextResponse } from "next/server";
import { getAuthContext, unauthorized, success } from "@/lib/api-utils";
import {
  extractDealInventory,
  applyDealInventory,
  getDealInventory,
} from "@/services/deal-inventory";

// crm-tools jobs take 30–90 s (Grok single-shot, Claude-Fallback bis ~2 min).
export const maxDuration = 300;

/**
 * Führt die Inventar-Extraktion aus dem Chatverlauf aus und persistiert das
 * Ergebnis (ersetzt frühere chat-Zeilen, Operator-Zeilen bleiben). Antwortet
 * mit der kompletten aktuellen Item-Liste.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ recordId: string }> }
) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();

  const { recordId } = await params;
  const result = await extractDealInventory(ctx.workspaceId, recordId, {
    background: true,
  });
  if (!result.items) {
    return NextResponse.json(
      { error: result.error ?? "Extraktion fehlgeschlagen" },
      { status: 422 }
    );
  }

  const applied = await applyDealInventory(
    ctx.workspaceId,
    recordId,
    result.items,
    ctx.userId
  );
  const items = await getDealInventory(ctx.workspaceId, recordId);
  return success({ items, inserted: applied.inserted, kept: applied.kept });
}
