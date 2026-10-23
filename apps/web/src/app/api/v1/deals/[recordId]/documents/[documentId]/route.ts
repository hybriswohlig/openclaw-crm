import { NextRequest, NextResponse } from "next/server";
import { getAuthContext, unauthorized } from "@/lib/api-utils";
import { db } from "@/db";
import { dealDocuments } from "@/db/schema/financial";
import { eq, and } from "drizzle-orm";
import { fileResponseHeaders } from "@/lib/file-response";
import { loeschbar } from "@/lib/portal-dokumente";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ recordId: string; documentId: string }> }
) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized(req);

  const { recordId, documentId } = await params;

  const [doc] = await db
    .select()
    .from(dealDocuments)
    .where(
      and(
        eq(dealDocuments.id, documentId),
        eq(dealDocuments.dealRecordId, recordId),
        eq(dealDocuments.workspaceId, ctx.workspaceId)
      )
    )
    .limit(1);

  if (!doc) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const buffer = Buffer.from(doc.fileContent, "base64");

  // Default to inline so PDFs/images preview in-browser. Use ?download=1 to
  // force the file save dialog (download button in the UI).
  const wantDownload = req.nextUrl.searchParams.get("download") === "1";

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      ...fileResponseHeaders({ mimeType: doc.mimeType, fileName: doc.fileName, download: wantDownload }),
      "Content-Length": String(buffer.length),
      "Cache-Control": "private, max-age=3600",
    },
  });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ recordId: string; documentId: string }> }
) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized(req);

  const { recordId, documentId } = await params;

  const scope = and(
    eq(dealDocuments.id, documentId),
    eq(dealDocuments.dealRecordId, recordId),
    eq(dealDocuments.workspaceId, ctx.workspaceId)
  );
  const [vorhanden] = await db.select({ documentType: dealDocuments.documentType }).from(dealDocuments).where(scope).limit(1);
  if (vorhanden && !loeschbar(vorhanden.documentType)) {
    return NextResponse.json(
      { error: "Der unterschriebene Vertrag gehört zur Annahme des Kunden und kann nicht gelöscht werden." },
      { status: 409 }
    );
  }

  const deleted = await db
    .delete(dealDocuments)
    .where(
      and(
        eq(dealDocuments.id, documentId),
        eq(dealDocuments.dealRecordId, recordId),
        eq(dealDocuments.workspaceId, ctx.workspaceId)
      )
    )
    .returning({ id: dealDocuments.id });

  if (deleted.length === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({ success: true });
}
