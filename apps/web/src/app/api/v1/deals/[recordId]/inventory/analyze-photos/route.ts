import { NextRequest, NextResponse } from "next/server";
import { getAuthContext, unauthorized, success } from "@/lib/api-utils";
import { analyzeInventoryPhotos, getDealInventory } from "@/services/deal-inventory";

// Bis zu 3 sequenzielle Vision-Batches à 30–90 s (Grok Build auf dem VPS).
export const maxDuration = 300;

/**
 * Foto-Analyse der Kundenbilder + Matching gegen die Inventarliste
 * (AI-Umzugsanalyse Phase 2b). Antwortet mit Zählern + aktueller Liste;
 * photosSkipped > 0 heißt: nochmal klicken für die restlichen Batches.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ recordId: string }> }
) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();

  const { recordId } = await params;
  const result = await analyzeInventoryPhotos(ctx.workspaceId, recordId, {
    background: true,
  });
  if (result.error && result.photosAnalyzed === 0) {
    return NextResponse.json({ error: result.error }, { status: 422 });
  }

  const items = await getDealInventory(ctx.workspaceId, recordId);
  return success({
    items,
    photosAnalyzed: result.photosAnalyzed,
    photosSkipped: result.photosSkipped,
    matched: result.matched,
    added: result.added,
  });
}
