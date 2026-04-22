import { NextRequest } from "next/server";
import { getAuthContext, unauthorized, success } from "@/lib/api-utils";
import { getAttachmentsForDeal } from "@/services/inbox";

// Lists every inbox attachment (email + WhatsApp) linked to this deal. Used
// by the lead detail page to surface customer-sent files in one place.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ recordId: string }> }
) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();

  const { recordId } = await params;
  const rows = await getAttachmentsForDeal(recordId, ctx.workspaceId);
  return success(rows);
}
