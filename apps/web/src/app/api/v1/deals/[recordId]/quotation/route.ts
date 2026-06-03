import { NextRequest } from "next/server";
import { getAuthContext, unauthorized, success } from "@/lib/api-utils";
import { getQuotation, upsertQuotation } from "@/services/quotations";
import { ensureCustomerStatusLink } from "@/services/customer-portal-data";
import { captureScopeSnapshot } from "@/services/scope-guard";
import { completeAgentPriceTasks } from "@/services/agent/agent-tasks";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ recordId: string }> }
) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();

  const { recordId } = await params;
  const data = await getQuotation(recordId);
  return success(data);
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ recordId: string }> }
) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();

  const { recordId } = await params;
  const body = await req.json();
  const data = await upsertQuotation(recordId, body);

  // The moment we have a quotation we have something worth showing the
  // customer — auto-mint the status link. Idempotent: re-saving the
  // quotation later is a no-op. Skipped silently when the OC has the
  // portal feature disabled in settings.
  await ensureCustomerStatusLink({
    workspaceId: ctx.workspaceId,
    dealRecordId: recordId,
    createdBy: ctx.userId,
  }).catch(() => {
    // Failure here must not block the quotation save.
  });

  // Anchor the scope baseline the first time a quote is issued, so later
  // KI extractions can detect (and warn on) a post-quote scope change.
  // Idempotent: no-op once a snapshot already exists for this deal.
  await captureScopeSnapshot(ctx.workspaceId, recordId, "issue");

  // Close the loop: a quote now exists, so complete any open agent-created
  // "price this lead" task and stop the overdue nudges.
  await completeAgentPriceTasks(ctx.workspaceId, recordId);

  return success(data);
}
