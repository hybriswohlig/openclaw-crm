import { NextRequest } from "next/server";
import { getAuthContext, unauthorized, success } from "@/lib/api-utils";
import { getFinancialOverview, getIncomeSeries } from "@/services/financial";

export async function GET(req: NextRequest) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();

  const { searchParams } = new URL(req.url);
  // e.g. ?month=2026-03  — omit for all-time overview
  const month = searchParams.get("month") || null;
  const seriesParam = searchParams.get("series");

  const overview = await getFinancialOverview(ctx.workspaceId, month);

  if (seriesParam) {
    const n = Math.max(1, Math.min(Number(seriesParam) || 6, 24));
    const series = await getIncomeSeries(ctx.workspaceId, n);
    return success({ ...overview, series });
  }

  return success(overview);
}
