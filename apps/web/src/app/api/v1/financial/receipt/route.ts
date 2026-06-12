import { NextRequest, NextResponse } from "next/server";
import { getAuthContext, unauthorized, badRequest, notFound } from "@/lib/api-utils";
import { getBookingReceipt, getLedgerReceipt } from "@/services/financial";

const VALID_TYPES = ["income", "expense", "ledger"] as const;
type ReceiptType = (typeof VALID_TYPES)[number];

/** Map common receipt mime types to a file extension for the download name. */
const MIME_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/heic": "heic",
  "application/pdf": "pdf",
};

const MIME_RE = /^[\w.+-]+\/[\w.+-]+$/;

/**
 * GET /api/v1/financial/receipt?type=income|expense|ledger&id=<id>
 *
 * Streams the stored receipt (data URL in the DB) as a binary response so the
 * browser can show or download the Beleg without loading the whole row.
 */
export async function GET(req: NextRequest) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();

  const searchParams = req.nextUrl.searchParams;
  const type = searchParams.get("type");
  const id = searchParams.get("id");

  if (!type || !VALID_TYPES.includes(type as ReceiptType)) {
    return badRequest("Query-Parameter type muss income, expense oder ledger sein");
  }
  if (!id) {
    return badRequest("Query-Parameter id ist erforderlich");
  }

  const receipt =
    type === "ledger"
      ? await getLedgerReceipt(ctx.workspaceId, id)
      : await getBookingReceipt(ctx.workspaceId, type as "income" | "expense", id);

  if (!receipt || !receipt.receiptFile) {
    return notFound("Beleg nicht gefunden");
  }

  // Stored format: data:<mime>;base64,<payload>
  const match = /^data:([^;,]*);base64,(.+)$/.exec(receipt.receiptFile);
  if (!match) {
    return notFound("Beleg nicht gefunden");
  }
  const mime = MIME_RE.test(match[1]) ? match[1] : "application/octet-stream";
  const buffer = Buffer.from(match[2], "base64");

  const ext = MIME_EXT[mime] ?? "bin";
  const filename = receipt.receiptName || `beleg-${id}.${ext}`;
  // ASCII-Fallback plus RFC-5987-Encoding, damit Umlaute im Belegnamen ankommen.
  const asciiName = filename.replace(/"/g, "'").replace(/[^\x20-\x7e]/g, "_");
  const contentDisposition = `inline; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(filename)}`;

  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type": mime,
      "Content-Length": String(buffer.length),
      "Content-Disposition": contentDisposition,
      "Cache-Control": "private, no-store",
    },
  });
}
