import { NextRequest } from "next/server";
import { getAuthContext, unauthorized, success } from "@/lib/api-utils";
import {
  extractDealInsights,
  transcriptFingerprint,
  InsightsSchema,
  type DealInsights,
} from "@/services/deal-insights";
import { getDealTranscript } from "@/services/deal-transcript";
import { applyDealInsights } from "@/services/deal-insights-apply";

export const dynamic = "force-dynamic";
// 5 minutes — covers slow free models (e.g. Nemotron) plus fallback retries.
export const maxDuration = 300;

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
 * Body (optional):
 *   `{ apply: true }` — extracted insights are written back to the deal
 *   record and an activity event is emitted. Default: preview-only.
 *
 *   `{ apply: true, insights, fingerprint }` — apply the PREVIEWED insights
 *   without re-running the extraction. `insights` must validate against the
 *   server-side schema and `fingerprint` must still match the current
 *   transcript (i.e. no new messages since the preview); otherwise the
 *   request falls back to a fresh extraction. This removes the second full
 *   LLM run that every apply used to pay for, and guarantees the user
 *   applies exactly the values they reviewed.
 *
 * Preview responses include `fingerprint` for exactly this round trip.
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
  let clientInsights: DealInsights | null = null;
  let clientFingerprint: string | null = null;
  try {
    const body = await req.json();
    apply = body?.apply === true;
    if (Array.isArray(body?.selectedFields)) selectedFields = body.selectedFields;
    if (body?.applyStage === true) applyStage = true;
    if (body?.applyNote === false) applyNote = false;
    if (body?.applyContact === false) applyContact = false;
    if (body?.applyAuftrag === false) applyAuftrag = false;
    if (typeof body?.fingerprint === "string") clientFingerprint = body.fingerprint;
    if (body?.insights && typeof body.insights === "object") {
      // Never trust the client blindly: the payload must round-trip through
      // the same Zod schema the extraction itself is validated against.
      const parsed = InsightsSchema.safeParse(body.insights);
      if (parsed.success) {
        clientInsights = parsed.data;
      } else {
        console.warn(
          `[insights] ${recordId}: client insights rejected by schema, falling back to re-extraction`,
          parsed.error.issues.slice(0, 3)
        );
      }
    }
  } catch {
    // No body or invalid JSON — default to preview-only.
  }

  // Fast apply path: reuse the previewed JSON when the conversation has not
  // moved since the preview. Costs one transcript read instead of a full
  // 15-80s LLM extraction.
  if (apply && clientInsights && clientFingerprint) {
    const transcript = await getDealTranscript(ctx.workspaceId, recordId);
    const currentFingerprint = transcriptFingerprint(transcript);
    if (currentFingerprint === clientFingerprint) {
      console.log(`[insights] ${recordId}: applying previewed insights (fingerprint match)`);
      const applyResult = await applyDealInsights({
        workspaceId: ctx.workspaceId,
        dealRecordId: recordId,
        insights: clientInsights,
        appliedBy: ctx.userId,
        selectedFields,
        applyStage,
        applyNote,
        applyContact,
        applyAuftrag,
      });
      return success({
        dealRecordId: recordId,
        transcript,
        insights: clientInsights,
        fingerprint: currentFingerprint,
        reusedPreview: true,
        applied: true,
        ...applyResult,
      });
    }
    console.log(
      `[insights] ${recordId}: fingerprint stale (${clientFingerprint} -> ${currentFingerprint}), re-extracting`
    );
  }

  const result = await extractDealInsights(ctx.workspaceId, recordId);
  const fingerprint = transcriptFingerprint(result.transcript);

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
    return success({ ...result, fingerprint, reusedPreview: false, applied: true, ...applyResult });
  }

  return success({ ...result, fingerprint, reusedPreview: false, applied: false });
}
