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
  try {
    const body = await req.json();
    apply = body?.apply === true;
  } catch {
    // No body or invalid JSON — default to preview-only.
  }

  const result = await extractDealInsights(ctx.workspaceId, recordId);

  if (apply && result.insights) {
    const { fieldsUpdated } = await applyDealInsights({
      workspaceId: ctx.workspaceId,
      dealRecordId: recordId,
      insights: result.insights,
      appliedBy: ctx.userId,
    });
    return success({ ...result, applied: true, fieldsUpdated });
  }

  return success({ ...result, applied: false });
}
