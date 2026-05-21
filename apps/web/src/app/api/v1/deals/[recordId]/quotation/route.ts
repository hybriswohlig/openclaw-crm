import { NextRequest } from "next/server";
import { getAuthContext, unauthorized, success } from "@/lib/api-utils";
import { getQuotation, upsertQuotation } from "@/services/quotations";
import { ensureCustomerStatusLink } from "@/services/customer-portal-data";

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

  return success(data);
}
