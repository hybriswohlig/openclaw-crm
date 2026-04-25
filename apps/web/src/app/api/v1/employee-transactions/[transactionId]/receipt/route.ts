import { NextRequest, NextResponse } from "next/server";
import { getAuthContext, unauthorized } from "@/lib/api-utils";
import { db } from "@/db";
import { employeeTransactions } from "@/db/schema/financial";
import { eq, and } from "drizzle-orm";

/**
 * Serves the receipt/invoice attached to an employee_transactions row.
 * Stored as a base64 data URL ("data:<mime>;base64,<payload>") to match the
 * pattern of employees.photo_base64 + deal_documents.file_content.
 *
 * Returns the binary file with the parsed mime type. ?download=1 forces a
 * save dialog; otherwise renders inline (PDF/image preview in the browser).
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ transactionId: string }> }
) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();

  const { transactionId } = await params;

  const [tx] = await db
    .select({
      receiptFile: employeeTransactions.receiptFile,
    })
    .from(employeeTransactions)
    .where(
      and(
        eq(employeeTransactions.id, transactionId),
        eq(employeeTransactions.workspaceId, ctx.workspaceId)
      )
    )
    .limit(1);

  if (!tx?.receiptFile) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Parse "data:<mime>;base64,<payload>"
  const m = /^data:([^;]+);base64,(.+)$/.exec(tx.receiptFile);
  if (!m) {
    return NextResponse.json({ error: "Invalid receipt format" }, { status: 415 });
  }
  const mimeType = m[1];
  const payload = m[2];
  const buffer = Buffer.from(payload, "base64");

  const wantDownload = req.nextUrl.searchParams.get("download") === "1";
  const disposition = wantDownload ? "attachment" : "inline";
  const ext = mimeType.split("/")[1] ?? "bin";
  const fileName = `beleg-${transactionId.slice(0, 8)}.${ext}`;

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": mimeType,
      "Content-Disposition": `${disposition}; filename="${fileName}"`,
      "Content-Length": String(buffer.length),
      "Cache-Control": "private, max-age=3600",
    },
  });
}
