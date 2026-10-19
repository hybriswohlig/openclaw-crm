import { NextRequest } from "next/server";
import { getAuthContext, unauthorized, success } from "@/lib/api-utils";
import { listSpeedToLead } from "@/services/speed-to-lead";

/** Open leads with no outbound reply yet, oldest first. */
export async function GET(req: NextRequest) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();
  const { searchParams } = new URL(req.url);
  const data = await listSpeedToLead(ctx.workspaceId, {
    source: searchParams.get("source"),
    company: searchParams.get("company"),
  });
  return success(data);
}
