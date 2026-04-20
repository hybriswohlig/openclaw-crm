import { NextRequest, NextResponse } from "next/server";
import {
  getAuthContext,
  unauthorized,
  success,
  badRequest,
} from "@/lib/api-utils";
import {
  startWhatsAppChatFromRecord,
  StartFromRecordError,
} from "@/services/inbox-whatsapp";

export async function POST(req: NextRequest) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();

  const body = await req.json().catch(() => ({}));
  const { recordId } = body as { recordId?: string };
  if (!recordId) return badRequest("recordId is required");

  try {
    const result = await startWhatsAppChatFromRecord({
      workspaceId: ctx.workspaceId,
      recordId,
    });
    return success(result);
  } catch (err) {
    if (err instanceof StartFromRecordError) {
      return NextResponse.json(
        { error: { code: err.code, message: err.message } },
        { status: 400 }
      );
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to start chat" },
      { status: 500 }
    );
  }
}
