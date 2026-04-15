import { NextRequest } from "next/server";
import { getAuthContext, unauthorized, success } from "@/lib/api-utils";
import { extractDealInsights } from "@/services/deal-insights";
import { getDealTranscript } from "@/services/deal-transcript";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** GET = read transcript only (cheap, no AI call). */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ recordId: string }> }
) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();

  const { recordId } = await params;
  const transcript = await getDealTranscript(ctx.workspaceId, recordId);
  return success({ transcript });
}

/** POST = run AI extraction. Triggered by an explicit user action in the UI. */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ recordId: string }> }
) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();

  const { recordId } = await params;
  const result = await extractDealInsights(ctx.workspaceId, recordId);
  return success(result);
}
