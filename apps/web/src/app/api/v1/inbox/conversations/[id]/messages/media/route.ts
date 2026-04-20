import { NextRequest, NextResponse } from "next/server";
import { getAuthContext, unauthorized, success } from "@/lib/api-utils";
import { db } from "@/db";
import { channelAccounts, inboxConversations } from "@/db/schema/inbox";
import { and, eq } from "drizzle-orm";
import {
  sendWhatsAppMediaReply,
  WhatsAppSessionExpiredError,
  WhatsAppMediaTooLargeError,
} from "@/services/inbox-whatsapp";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();

  const { id } = await params;

  const [row] = await db
    .select({ channelType: channelAccounts.channelType })
    .from(inboxConversations)
    .innerJoin(
      channelAccounts,
      eq(inboxConversations.channelAccountId, channelAccounts.id)
    )
    .where(
      and(
        eq(inboxConversations.id, id),
        eq(inboxConversations.workspaceId, ctx.workspaceId)
      )
    )
    .limit(1);
  if (!row) {
    return NextResponse.json(
      { error: "Conversation not found" },
      { status: 404 }
    );
  }
  if (row.channelType !== "whatsapp") {
    return NextResponse.json(
      { error: "Media replies are only supported for WhatsApp conversations" },
      { status: 400 }
    );
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json(
      { error: "Expected multipart/form-data body" },
      { status: 400 }
    );
  }

  const file = form.get("file");
  const caption = form.get("caption");
  if (!(file instanceof Blob) || file.size === 0) {
    return NextResponse.json(
      { error: "file field is required" },
      { status: 400 }
    );
  }

  const filename =
    file instanceof File && file.name ? file.name : "attachment";
  const mimeType = file.type || "application/octet-stream";

  try {
    const msg = await sendWhatsAppMediaReply({
      conversationId: id,
      workspaceId: ctx.workspaceId,
      file: {
        blob: file,
        mimeType,
        filename,
        size: file.size,
      },
      caption: typeof caption === "string" ? caption : undefined,
    });
    return success(msg);
  } catch (err) {
    if (err instanceof WhatsAppSessionExpiredError) {
      return NextResponse.json(
        { error: { code: "WA_SESSION_EXPIRED", message: err.message } },
        { status: 409 }
      );
    }
    if (err instanceof WhatsAppMediaTooLargeError) {
      return NextResponse.json(
        { error: { code: "WA_MEDIA_TOO_LARGE", message: err.message } },
        { status: 413 }
      );
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Send failed" },
      { status: 500 }
    );
  }
}
