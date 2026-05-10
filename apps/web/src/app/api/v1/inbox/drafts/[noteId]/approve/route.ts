import { NextRequest, NextResponse } from "next/server";
import { getAuthContext, success, unauthorized } from "@/lib/api-utils";
import { approveDraft, DraftApprovalError } from "@/services/agent-drafts";

/**
 * POST /api/v1/inbox/drafts/[noteId]/approve
 *
 * Body: `{ body?: string }` — optional override; without it the route
 * re-extracts the email body from the current note content (so an Edit-then-
 * Approve flow uses the latest text). Sends via the existing send pipeline,
 * marks the note consumed, and best-effort sets `first_reply_at` on the
 * parent record. See `services/agent-drafts.ts`.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ noteId: string }> }
) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();

  const { noteId } = await params;

  let bodyOverride: string | undefined;
  try {
    const json = (await req.json()) as { body?: unknown } | null;
    if (json && typeof json.body === "string") {
      bodyOverride = json.body;
    }
  } catch {
    // Empty / non-JSON request body is allowed — falls back to extraction.
  }

  try {
    const result = await approveDraft({
      workspaceId: ctx.workspaceId,
      noteId,
      bodyOverride,
    });
    return success(result);
  } catch (err) {
    if (err instanceof DraftApprovalError) {
      return NextResponse.json(
        { error: { code: err.code, message: err.message } },
        { status: err.status }
      );
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Approve failed" },
      { status: 500 }
    );
  }
}
