import { NextRequest, NextResponse } from "next/server";
import { getAuthContext, unauthorized, success } from "@/lib/api-utils";
import { db } from "@/db";
import { dealDocuments } from "@/db/schema/financial";
import { eq, and } from "drizzle-orm";
import {
  createDealDocument,
  validateDealDocumentUpload,
} from "@/services/deal-documents";

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

  const check = validateDealDocumentUpload({
    fileName: file.name,
    fileSize: file.size,
    documentType,
  });
  if (!check.ok) {
    return NextResponse.json({ error: check.error }, { status: check.status });
  }

  const buffer = await file.arrayBuffer();
  const doc = await createDealDocument({
    workspaceId: ctx.workspaceId,
    dealRecordId: recordId,
    documentType: check.documentType,
    fileName: file.name,
    fileSize: file.size,
    mimeType: file.type || "application/octet-stream",
    fileContent: Buffer.from(buffer).toString("base64"),
  });

  return success(doc);
}
