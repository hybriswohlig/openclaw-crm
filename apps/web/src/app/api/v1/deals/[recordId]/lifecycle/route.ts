import { NextRequest } from "next/server";
import { getAuthContext, unauthorized, success } from "@/lib/api-utils";
import { getDealLifecycle } from "@/services/deal-lifecycle";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/deals/[recordId]/lifecycle
 *
 * Returns the five customer-lifecycle milestones (Erstkontakt → Infos →
 * Angebot → Umzugstermin → Bezahlt) with timestamps and which one is
 * currently in flight, for the inbox context panel's Interaktionen timeline.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ recordId: string }> }
) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();

  const { recordId } = await params;
  const data = await getDealLifecycle(ctx.workspaceId, recordId);
  return success(data);
}
