import { NextRequest, NextResponse } from "next/server";
import { getAuthContext, unauthorized, success } from "@/lib/api-utils";
import { db } from "@/db";
import { dealDocuments } from "@/db/schema/financial";
import { eq, and } from "drizzle-orm";
import { prepareJsonDealDocument, validateDealDocumentUpload } from "@/lib/deal-document-upload";
import { createDealDocument } from "@/services/deal-documents";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ recordId: string }> }
) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized(req);

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
  if (!ctx) return unauthorized(req);

  const { recordId } = await params;
  const contentType = (req.headers.get("content-type") ?? "").toLowerCase();

  // MCP clients send JSON only. The staff UI keeps sending multipart.
  if (contentType.includes("application/json")) {
    return postDealDocumentJson(req, ctx.workspaceId, recordId);
  }
  return postDealDocumentMultipart(req, ctx.workspaceId, recordId);
}

/**
 * JSON/base64 upload used by crm_upload_deal_document.
 * notifyCustomer defaults to false: storing an invoice or order confirmation
 * must not WhatsApp or email the customer unless the caller opts in.
 */
async function postDealDocumentJson(
  req: NextRequest,
  workspaceId: string,
  recordId: string
) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const record = body as Record<string, unknown>;
  const prepared = prepareJsonDealDocument({
    fileName: record.fileName,
    documentType: record.documentType,
    mimeType: record.mimeType,
    contentBase64: record.contentBase64,
  });
  if (!prepared.ok) {
    return NextResponse.json({ error: prepared.error }, { status: prepared.status });
  }

  const doc = await createDealDocument({
    workspaceId,
    dealRecordId: recordId,
    documentType: prepared.documentType,
    fileName: prepared.fileName,
    fileSize: prepared.fileSize,
    mimeType: prepared.mimeType,
    fileContent: prepared.fileContent,
    notifyCustomer: record.notifyCustomer === true,
  });

  return success(doc);
}

async function postDealDocumentMultipart(
  req: NextRequest,
  workspaceId: string,
  recordId: string
) {
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
    workspaceId,
    dealRecordId: recordId,
    documentType: check.documentType,
    fileName: file.name,
    fileSize: file.size,
    mimeType: file.type || "application/octet-stream",
    fileContent: Buffer.from(buffer).toString("base64"),
  });

  return success(doc);
}
