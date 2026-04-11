import { NextRequest } from "next/server";
import { getAuthContext, unauthorized, success } from "@/lib/api-utils";
import { getFinancialOverview } from "@/services/financial";

export async function GET(req: NextRequest) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();

  const data = await getFinancialOverview(ctx.workspaceId);
  return success(data);
}
