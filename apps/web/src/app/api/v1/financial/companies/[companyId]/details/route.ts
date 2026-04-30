import { NextRequest } from "next/server";
import { getAuthContext, unauthorized, success } from "@/lib/api-utils";
import { getCompanyDetails } from "@/services/financial";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ companyId: string }> }
) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();

  const { companyId: rawId } = await params;
  // The "Nicht zugewiesen" bucket has no id — we encode it as "unassigned".
  const companyId = rawId === "unassigned" ? null : rawId;

  const { searchParams } = new URL(req.url);
  const month = searchParams.get("month") || null;

  const data = await getCompanyDetails(ctx.workspaceId, companyId, month);
  return success(data);
}
