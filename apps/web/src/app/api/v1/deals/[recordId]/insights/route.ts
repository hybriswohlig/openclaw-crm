import { NextRequest } from "next/server";
import { getAuthContext, unauthorized, success } from "@/lib/api-utils";
import { extractDealInsights } from "@/services/deal-insights";
import { getDealTranscript } from "@/services/deal-transcript";
import { applyDealInsights } from "@/services/deal-insights-apply";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** GET = read transcript only (cheap, no AI call). */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ recordId: string }> }
) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();

  const { recordId } = await params;
  const transcript = await getDealTranscript(ctx.workspaceId, recordId);
  return success({ transcript });
}

/**
 * POST = run AI extraction. Triggered by an explicit user action in the UI.
 *
 * Body (optional): `{ apply: true }` — when set, extracted insights are
 * written back to the deal record and an activity event is emitted.
 * Default (no body or `apply: false`): preview-only, nothing is persisted.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ recordId: string }> }
) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();

  const { recordId } = await params;

  let apply = false;
  let selectedFields: string[] | undefined;
  let applyStage = false;
  let applyNote = true;
  let applyContact = true;
  let applyAuftrag = true;
  try {
    const body = await req.json();
    apply = body?.apply === true;
    if (Array.isArray(body?.selectedFields)) selectedFields = body.selectedFields;
    if (body?.applyStage === true) applyStage = true;
    if (body?.applyNote === false) applyNote = false;
    if (body?.applyContact === false) applyContact = false;
    if (body?.applyAuftrag === false) applyAuftrag = false;
  } catch {
    // No body or invalid JSON — default to preview-only.
  }

  const result = await extractDealInsights(ctx.workspaceId, recordId);

  if (apply && result.insights) {
    const applyResult = await applyDealInsights({
      workspaceId: ctx.workspaceId,
      dealRecordId: recordId,
      insights: result.insights,
      appliedBy: ctx.userId,
      selectedFields,
      applyStage,
      applyNote,
      applyContact,
      applyAuftrag,
    });
    return success({ ...result, applied: true, ...applyResult });
  }

  return success({ ...result, applied: false });
}
