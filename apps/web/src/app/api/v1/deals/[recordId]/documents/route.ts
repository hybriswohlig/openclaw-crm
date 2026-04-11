import { NextRequest, NextResponse } from "next/server";
import { getAuthContext, unauthorized, success } from "@/lib/api-utils";
import { db } from "@/db";
import { dealDocuments } from "@/db/schema/financial";
import { eq, and } from "drizzle-orm";

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ recordId: string }> }
) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();

  const { recordId } = await params;

  const docs = await db
    .select({
      id: dealDocuments.id,
      documentType: dealDocuments.documentType,
      fileName: dealDocuments.fileName,
      fileSize: dealDocuments.fileSize,
      mimeType: dealDocuments.mimeType,
      uploadedAt: dealDocuments.uploadedAt,
    })
    .from(dealDocuments)
    .where(
      and(
        eq(dealDocuments.workspaceId, ctx.workspaceId),
        eq(dealDocuments.dealRecordId, recordId)
      )
    )
    .orderBy(dealDocuments.uploadedAt);

  return success(docs);
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ recordId: string }> }
) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();

  const { recordId } = await params;

  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  const documentType = formData.get("documentType") as string | null;

  if (!file || !documentType) {
    return NextResponse.json({ error: "file and documentType are required" }, { status: 400 });
  }

  const validTypes = ["order_confirmation", "invoice", "payment_confirmation"];
  if (!validTypes.includes(documentType)) {
    return NextResponse.json({ error: "Invalid documentType" }, { status: 400 });
  }

  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json({ error: "File too large (max 10 MB)" }, { status: 413 });
  }

  const buffer = await file.arrayBuffer();
  const base64 = Buffer.from(buffer).toString("base64");

  const [doc] = await db
    .insert(dealDocuments)
    .values({
      workspaceId: ctx.workspaceId,
      dealRecordId: recordId,
      documentType: documentType as "order_confirmation" | "invoice" | "payment_confirmation",
      fileName: file.name,
      fileSize: file.size,
      mimeType: file.type || "application/octet-stream",
      fileContent: base64,
    })
    .returning({
      id: dealDocuments.id,
      documentType: dealDocuments.documentType,
      fileName: dealDocuments.fileName,
      fileSize: dealDocuments.fileSize,
      mimeType: dealDocuments.mimeType,
      uploadedAt: dealDocuments.uploadedAt,
    });

  return success(doc);
}
