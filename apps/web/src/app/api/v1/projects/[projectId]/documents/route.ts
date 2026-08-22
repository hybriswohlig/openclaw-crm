import { NextRequest, NextResponse } from "next/server";
import { getAuthContext, unauthorized, notFound, success } from "@/lib/api-utils";
import {
  listProjectDocuments,
  createProjectDocument,
  validateProjectDocumentUpload,
} from "@/services/project-documents";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();
  const { projectId } = await params;
  return success(await listProjectDocuments(ctx.workspaceId, projectId));
}

/** POST — multipart/form-data with a single `file` field. */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();
  const { projectId } = await params;

  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  if (!file) {
    return NextResponse.json(
      { error: { code: "BAD_REQUEST", message: "file ist erforderlich." } },
      { status: 400 },
    );
  }

  const check = validateProjectDocumentUpload({
    fileName: file.name,
    mimeType: file.type,
    fileSize: file.size,
  });
  if (!check.ok) {
    return NextResponse.json(
      { error: { code: check.status === 413 ? "PAYLOAD_TOO_LARGE" : "BAD_REQUEST", message: check.error } },
      { status: check.status },
    );
  }

  const buffer = await file.arrayBuffer();
  const base64 = Buffer.from(buffer).toString("base64");

  const doc = await createProjectDocument(ctx.workspaceId, projectId, ctx.userId, {
    fileName: file.name,
    mimeType: file.type || "application/octet-stream",
    fileSize: file.size,
    fileContent: base64,
  });
  if (!doc) return notFound("Projekt nicht gefunden");
  return success(doc, 201);
}
