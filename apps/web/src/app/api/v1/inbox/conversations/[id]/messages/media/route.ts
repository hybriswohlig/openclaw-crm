import { NextRequest, NextResponse } from "next/server";
import { del, get } from "@vercel/blob";
import { getAuthContext, unauthorized, success } from "@/lib/api-utils";
import { db } from "@/db";
import { channelAccounts, inboxConversations } from "@/db/schema/inbox";
import { and, eq } from "drizzle-orm";
import {
  INBOX_BLOB_MAX_BYTES,
  isInboxMediaBlobPath,
  isVercelBlobUrl,
} from "@/lib/inbox-media-upload";
import {
  sendWhatsAppMediaReply,
  sendBaileysMediaReply,
  WhatsAppSessionExpiredError,
  WhatsAppMediaTooLargeError,
  BaileysBridgeNotConfiguredError,
  BaileysBridgeError,
} from "@/services/inbox-whatsapp";

export const maxDuration = 60;

async function fileFromBlob(conversationId: string, body: unknown) {
  if (!body || typeof body !== "object") return null;
  const blobUrl = "blobUrl" in body && typeof body.blobUrl === "string" ? body.blobUrl : "";
  if (!isVercelBlobUrl(blobUrl)) {
    throw new Error("Ungültige Datei-Adresse.");
  }
  const downloaded = await get(blobUrl, { access: "private" });
  if (!downloaded || downloaded.statusCode !== 200) {
    throw new Error("Datei konnte nicht gelesen werden.");
  }
  if (!isInboxMediaBlobPath(downloaded.blob.pathname, conversationId)) {
    throw new Error("Die Datei gehört nicht zu dieser Unterhaltung.");
  }
  if (downloaded.blob.size > INBOX_BLOB_MAX_BYTES) {
    throw new Error("Die Datei ist größer als 20 MB.");
  }
  const bytes = new Uint8Array(await new Response(downloaded.stream).arrayBuffer());
  await del(blobUrl).catch(() => {});
  const named = "filename" in body && typeof body.filename === "string" ? body.filename : "";
  const typed = "mimeType" in body && typeof body.mimeType === "string" ? body.mimeType : "";
  const caption = "caption" in body && typeof body.caption === "string" ? body.caption : undefined;
  return {
    filename: named || downloaded.blob.pathname.split("/").pop() || "attachment",
    mimeType: typed || downloaded.blob.contentType || "application/octet-stream",
    size: bytes.length,
    blob: new Blob([bytes], { type: typed || downloaded.blob.contentType || "application/octet-stream" }),
    caption,
  };
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();

  const { id } = await params;

  const [row] = await db
    .select({
      channelType: channelAccounts.channelType,
      waPhoneNumberId: channelAccounts.waPhoneNumberId,
      baileysBridgeProvider: channelAccounts.baileysBridgeProvider,
    })
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
  const isBaileysInhouse =
    row.waPhoneNumberId === null &&
    row.baileysBridgeProvider === "inhouse";
  const isBaileysOpenclaw =
    row.waPhoneNumberId === null &&
    row.baileysBridgeProvider !== "inhouse";
  if (isBaileysOpenclaw) {
    return NextResponse.json(
      {
        error: {
          code: "OPENCLAW_OUTBOUND_NOT_IMPLEMENTED",
          message:
            "This WhatsApp number is bridged via OpenClaw; outbound media is not wired through the CRM. Switch to the in-house bridge in Integrations.",
        },
      },
      { status: 501 }
    );
  }

  const contentType = req.headers.get("content-type") ?? "";
  let filename = "attachment";
  let mimeType = "application/octet-stream";
  let size = 0;
  let blob: Blob;
  let caption: string | undefined;

  try {
    if (contentType.includes("application/json")) {
      const fromBlob = await fileFromBlob(id, await req.json());
      if (!fromBlob || fromBlob.size === 0) {
        return NextResponse.json({ error: "file field is required" }, { status: 400 });
      }
      filename = fromBlob.filename;
      mimeType = fromBlob.mimeType;
      size = fromBlob.size;
      blob = fromBlob.blob;
      caption = fromBlob.caption;
    } else {
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
      const formCaption = form.get("caption");
      if (!(file instanceof Blob) || file.size === 0) {
        return NextResponse.json({ error: "file field is required" }, { status: 400 });
      }
      filename = file instanceof File && file.name ? file.name : "attachment";
      mimeType = file.type || "application/octet-stream";
      size = file.size;
      blob = file;
      caption = typeof formCaption === "string" ? formCaption : undefined;
    }
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Datei konnte nicht gelesen werden." },
      { status: 400 }
    );
  }

  try {
    const msg = isBaileysInhouse
      ? await sendBaileysMediaReply({
          conversationId: id,
          workspaceId: ctx.workspaceId,
          file: { blob, mimeType, filename, size },
          caption,
        })
      : await sendWhatsAppMediaReply({
          conversationId: id,
          workspaceId: ctx.workspaceId,
          file: { blob, mimeType, filename, size },
          caption,
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
    if (err instanceof BaileysBridgeNotConfiguredError) {
      return NextResponse.json(
        {
          error: {
            code: "BAILEYS_BRIDGE_NOT_CONFIGURED",
            message: err.message,
          },
        },
        { status: 503 }
      );
    }
    if (err instanceof BaileysBridgeError) {
      return NextResponse.json(
        {
          error: {
            code: "BAILEYS_BRIDGE_ERROR",
            status: err.status,
            message: err.message,
          },
        },
        { status: 502 }
      );
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Send failed" },
      { status: 500 }
    );
  }
}
