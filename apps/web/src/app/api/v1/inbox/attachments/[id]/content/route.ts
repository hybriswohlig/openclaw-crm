import { NextRequest, NextResponse } from "next/server";
import { getAuthContext, unauthorized, success } from "@/lib/api-utils";
import { getAttachmentWithContent } from "@/services/inbox";
import { toAttachmentPayload } from "@/lib/attachment-content";

// Streams the base64-decoded bytes of an attachment. The inbox renders
// <img src="/api/v1/inbox/attachments/{id}/content" /> against this route.
// Auth is mandatory — we never expose customer attachments without a session.
//
// ?format=json returns the same bytes base64-wrapped in JSON instead of raw
// binary. It exists because this URL is the one visible in the inbox markup,
// so agents copy it and then die on the binary body; ../[id] is the canonical
// JSON route. Anything other than format=json keeps streaming bytes, so the
// <img> path is byte-for-byte unchanged.
//
// Missing / foreign-workspace rows answer JSON `{ error: "Not found" }` rather
// than the Next.js HTML app shell, so crm_api can report a real 404.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();

  const { id } = await params;
  const row = await getAttachmentWithContent(id, ctx.workspaceId);
  if (!row) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (req.nextUrl.searchParams.get("format") === "json") {
    return success(toAttachmentPayload(row));
  }

  const bytes = Buffer.from(row.fileContent, "base64");
  return new NextResponse(new Uint8Array(bytes), {
    status: 200,
    headers: {
      "Content-Type": row.mimeType,
      "Content-Length": String(bytes.length),
      "Content-Disposition": `inline; filename="${encodeURIComponent(row.fileName)}"`,
      "Cache-Control": "private, max-age=3600",
    },
  });
}
