import { NextRequest } from "next/server";
import { getAuthContext, unauthorized, success } from "@/lib/api-utils";
import { getOperationsStats } from "@/services/statistics";

export async function GET(req: NextRequest) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();

  const data = await getOperationsStats(ctx.workspaceId);
  return success(data);
}
