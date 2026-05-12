import { NextRequest } from "next/server";
import { getAuthContext, unauthorized, success } from "@/lib/api-utils";
import { getCompanyComparison, type Period } from "@/services/statistics";

const VALID_PERIODS: Period[] = ["30d", "90d", "365d", "ytd"];

export async function GET(req: NextRequest) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();

  const raw = new URL(req.url).searchParams.get("period") ?? "90d";
  const period = (VALID_PERIODS as string[]).includes(raw) ? (raw as Period) : "90d";

  const data = await getCompanyComparison(ctx.workspaceId, period);
  return success({ period, rows: data });
}
