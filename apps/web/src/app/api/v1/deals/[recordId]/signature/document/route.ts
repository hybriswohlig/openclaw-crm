/**
 * Signed contract PDF (Vertragsmappe) for a deal.
 *
 * GET /api/v1/deals/[recordId]/signature/document?confirmationId=
 *
 * Streams the file. The MCP client wraps the bytes as contentBase64.
 * Does not email or message the customer.
 */
import { NextRequest, NextResponse } from "next/server";
import { getAuthContext, unauthorized, notFound } from "@/lib/api-utils";
import { fileResponseHeaders } from "@/lib/file-response";
import { loadSignedDocument } from "@/services/deal-signature";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ recordId: string }> }
) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized(req);
  const { recordId } = await params;
  const confirmationId = req.nextUrl.searchParams.get("confirmationId");
  const doc = await loadSignedDocument({
    workspaceId: ctx.workspaceId,
    dealRecordId: recordId,
    confirmationId,
  });
  if (!doc) return notFound("Signed document not found");

  const buffer = Buffer.from(doc.fileContent, "base64");
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      ...fileResponseHeaders({ mimeType: doc.mimeType, fileName: doc.fileName }),
      "Content-Length": String(buffer.length),
      "Cache-Control": "private, max-age=3600",
      "X-Confirmation-Id": doc.confirmationId,
      "X-Signature-Superseded": doc.superseded ? "1" : "0",
    },
  });
}
