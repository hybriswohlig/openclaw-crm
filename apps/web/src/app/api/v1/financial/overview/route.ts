import { NextRequest } from "next/server";
import { getAuthContext, unauthorized, success } from "@/lib/api-utils";
import { getFinancialOverview } from "@/services/financial";

export async function GET(req: NextRequest) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();

  const { searchParams } = new URL(req.url);
  // e.g. ?month=2026-03  — omit for all-time overview
  const month = searchParams.get("month") || null;

  const data = await getFinancialOverview(ctx.workspaceId, month);
  return success(data);
}
