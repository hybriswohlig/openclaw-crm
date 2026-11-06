import { NextRequest, NextResponse } from "next/server";
import { getAuthContext, unauthorized, success, badRequest } from "@/lib/api-utils";
import { sendWhatsAppTemplate } from "@/services/inbox-whatsapp";
import { vermerkeEigeneNachricht } from "@/services/inbox-senden";

export async function POST(req: NextRequest) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized(req);

  const body = await req.json().catch(() => ({}));
  const {
    channelAccountId,
    toPhone,
    customerName,
    templateName,
    languageCode,
    bodyParams,
    dealRecordId,
  } = body as {
    channelAccountId?: string;
    toPhone?: string;
    customerName?: string;
    templateName?: string;
    languageCode?: string;
    bodyParams?: string[];
    dealRecordId?: string | null;
  };

  if (!channelAccountId || !toPhone || !templateName || !languageCode) {
    return badRequest(
      "channelAccountId, toPhone, templateName and languageCode are required"
    );
  }

  try {
    const result = await sendWhatsAppTemplate({
      workspaceId: ctx.workspaceId,
      channelAccountId,
      toPhone,
      customerName: customerName ?? "",
      templateName,
      languageCode,
      bodyParams: Array.isArray(bodyParams) ? bodyParams : [],
      dealRecordId: typeof dealRecordId === "string" ? dealRecordId : null,
    });
    // Wartet-Signal on the conversation's deal (handed in, back-filled or newly
    // minted). Best-effort inside vermerkeEigeneNachricht.
    const sentAt = result.message?.sentAt;
    await vermerkeEigeneNachricht({
      workspaceId: ctx.workspaceId,
      conversationId: result.conversationId,
      sentAt: sentAt instanceof Date ? sentAt : new Date(),
    });
    return success(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Send failed" },
      { status: 500 }
    );
  }
}
