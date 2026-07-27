import { NextRequest, NextResponse } from "next/server";
import { getAuthContext, unauthorized, success } from "@/lib/api-utils";
import {
  generateScopeFromPhotos,
  MAX_SCOPE_PHOTOS_PER_REQUEST,
} from "@/services/ai/scope-from-photos";

export const dynamic = "force-dynamic";
// Same convention as the insights route: the crm-tools job is polled for up
// to ~290s, so the function budget must sit above that.
export const maxDuration = 300;

/**
 * POST = generate the customer-facing scope summary ("Was umfasst der
 * Auftrag") from selected deal photos. Operator-triggered in the deal UI.
 *
 * Body: { attachmentIds: string[] } with 1 to MAX_SCOPE_PHOTOS_PER_REQUEST
 * ids. More than 6 photos are analysed in sequential batches of 6 / 8 MB.
 *
 * 200 { data: { summary, inventory, hints, photosAnalyzed, photosSkipped, batchesRun } }
 * 400 { error: { code: "INVALID_INPUT" | "NO_PHOTOS" } }
 * 502 { error: { code: "AI_FAILED" } }
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ recordId: string }> }
) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();

  const { recordId } = await params;

  let attachmentIds: unknown = null;
  try {
    const body = await req.json();
    attachmentIds = body?.attachmentIds;
  } catch {
    // No body or invalid JSON falls through to INVALID_INPUT below.
  }

  if (
    !Array.isArray(attachmentIds) ||
    attachmentIds.length < 1 ||
    attachmentIds.length > MAX_SCOPE_PHOTOS_PER_REQUEST ||
    !attachmentIds.every((id): id is string => typeof id === "string" && id.length > 0)
  ) {
    return NextResponse.json({ error: { code: "INVALID_INPUT" } }, { status: 400 });
  }

  const result = await generateScopeFromPhotos({
    workspaceId: ctx.workspaceId,
    dealRecordId: recordId,
    attachmentIds,
  });

  if (!result.ok) {
    const status = result.error === "NO_PHOTOS" ? 400 : 502;
    return NextResponse.json({ error: { code: result.error } }, { status });
  }

  return success({
    summary: result.summary,
    inventory: result.inventory,
    hints: result.hints,
    photosAnalyzed: result.photosAnalyzed,
    photosSkipped: result.photosSkipped,
    batchesRun: result.batchesRun,
  });
}
