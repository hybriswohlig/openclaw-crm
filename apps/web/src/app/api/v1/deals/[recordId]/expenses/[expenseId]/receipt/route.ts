import { NextRequest, NextResponse } from "next/server";
import { getAuthContext, unauthorized } from "@/lib/api-utils";
import { db } from "@/db";
import { expenses } from "@/db/schema/financial";
import { eq, and } from "drizzle-orm";

/**
 * Serves the receipt/invoice attached to an expense row.
 * Stored as a base64 data URL ("data:<mime>;base64,<payload>").
 *
 * ?download=1 forces a save dialog; otherwise renders inline.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ expenseId: string }> }
) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();

  const { expenseId } = await params;

  const [row] = await db
    .select({ receiptFile: expenses.receiptFile })
    .from(expenses)
    .where(and(eq(expenses.id, expenseId), eq(expenses.workspaceId, ctx.workspaceId)))
    .limit(1);

  if (!row?.receiptFile) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const m = /^data:([^;]+);base64,(.+)$/.exec(row.receiptFile);
  if (!m) {
    return NextResponse.json({ error: "Invalid receipt format" }, { status: 415 });
  }
  const mimeType = m[1];
  const buffer = Buffer.from(m[2], "base64");

  const wantDownload = req.nextUrl.searchParams.get("download") === "1";
  const disposition = wantDownload ? "attachment" : "inline";
  const ext = mimeType.split("/")[1] ?? "bin";
  const fileName = `beleg-${expenseId.slice(0, 8)}.${ext}`;

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": mimeType,
      "Content-Disposition": `${disposition}; filename="${fileName}"`,
      "Content-Length": String(buffer.length),
      "Cache-Control": "private, max-age=3600",
    },
  });
}
