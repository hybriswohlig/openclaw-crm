import { NextRequest } from "next/server";
import { getAuthContext, success, unauthorized } from "@/lib/api-utils";
import { getOperationsView } from "@/services/operations";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();
  const data = await getOperationsView(ctx.workspaceId);
  return success(data);
}
