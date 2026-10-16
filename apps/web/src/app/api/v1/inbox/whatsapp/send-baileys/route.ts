import { NextRequest, NextResponse } from "next/server";
import { getAuthContext, unauthorized, success, badRequest } from "@/lib/api-utils";
import { sendBaileysFirstMessage } from "@/services/inbox-whatsapp";
import { supersedePendingDrafts } from "@/services/agent/draft-schliessen";

/**
 * First-contact send for personal-WhatsApp (Baileys) channel accounts.
 * The WABA composer opens conversations with approved templates; Baileys has
 * no template requirement, so this route accepts a free-form text body.
 */
export async function POST(req: NextRequest) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();

  const payload = await req.json().catch(() => ({}));
  const { channelAccountId, toPhone, customerName, body, dealRecordId } =
    payload as {
      channelAccountId?: string;
      toPhone?: string;
      customerName?: string;
      body?: string;
      dealRecordId?: string | null;
    };

  if (!channelAccountId || !toPhone || !body || !body.trim()) {
    return badRequest("channelAccountId, toPhone and body are required");
  }

  try {
    const linkedDeal = typeof dealRecordId === "string" ? dealRecordId : null;
    const result = await sendBaileysFirstMessage({
      workspaceId: ctx.workspaceId,
      channelAccountId,
      toPhone,
      customerName: customerName ?? "",
      body,
      dealRecordId: linkedDeal,
    });
    // First-contact drafts often have no conversation yet and hang off the
    // deal. Close both so approve_and_send cannot send the draft afterwards.
    try {
      await supersedePendingDrafts({
        workspaceId: ctx.workspaceId,
        conversationId: result.conversationId,
        dealRecordId: linkedDeal,
        userId: ctx.userId,
        supersededBy: "manual_send",
      });
    } catch (draftErr) {
      console.error(
        "[inbox] supersede drafts after baileys first send failed (non-fatal):",
        draftErr
      );
    }
    return success({ conversationId: result.conversationId });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Send failed" },
      { status: 500 }
    );
  }
}
