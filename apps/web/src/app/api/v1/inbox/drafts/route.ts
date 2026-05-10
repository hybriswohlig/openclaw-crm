import { NextRequest } from "next/server";
import { getAuthContext, success, unauthorized } from "@/lib/api-utils";
import { listPendingDrafts } from "@/services/agent-drafts";

/**
 * GET /api/v1/inbox/drafts
 *
 * Returns every pending Sales-Outreach-Agent "Antwort-Entwurf" note in the
 * workspace, newest first. Backs the `/inbox/drafts` approval queue UI.
 */
export async function GET(req: NextRequest) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();

  const drafts = await listPendingDrafts(ctx.workspaceId);
  return success({ drafts });
}
