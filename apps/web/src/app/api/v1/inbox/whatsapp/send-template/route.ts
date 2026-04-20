import { NextRequest, NextResponse } from "next/server";
import { getAuthContext, unauthorized, success, badRequest } from "@/lib/api-utils";
import { sendWhatsAppTemplate } from "@/services/inbox-whatsapp";

export async function POST(req: NextRequest) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();

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
    return success(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Send failed" },
      { status: 500 }
    );
  }
}
