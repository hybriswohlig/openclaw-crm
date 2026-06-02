import { NextRequest } from "next/server";
import { getAuthContext, unauthorized, success } from "@/lib/api-utils";
import { resolveScopeChange } from "@/services/scope-guard";

export const dynamic = "force-dynamic";

/**
 * POST /api/v1/deals/[recordId]/scope-change
 * Body: { action: "accept" | "dismiss" }
 *   accept  = operator re-quoted: promote pending scope + re-anchor baseline.
 *   dismiss = keep the quoted scope; just clear the warning flag.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ recordId: string }> }
) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();

  const { recordId } = await params;
  let action: "accept" | "dismiss" = "dismiss";
  try {
    const body = await req.json();
    if (body?.action === "accept") action = "accept";
  } catch {
    // default: dismiss
  }

  await resolveScopeChange(ctx.workspaceId, recordId, action, ctx.userId);
  return success({ ok: true, action });
}
