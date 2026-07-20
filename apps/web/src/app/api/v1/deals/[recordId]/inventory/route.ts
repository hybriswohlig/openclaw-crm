import { NextRequest } from "next/server";
import { getAuthContext, unauthorized, success } from "@/lib/api-utils";
import { getDealInventory } from "@/services/deal-inventory";

/** Strukturiertes Umzugs-Inventar eines Deals (AI-Umzugsanalyse Phase 2). */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ recordId: string }> }
) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();

  const { recordId } = await params;
  const items = await getDealInventory(ctx.workspaceId, recordId);
  return success(items);
}
