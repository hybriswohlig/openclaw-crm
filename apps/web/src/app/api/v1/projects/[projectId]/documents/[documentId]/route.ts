import { NextRequest, NextResponse } from "next/server";
import { getAuthContext, unauthorized, notFound, success } from "@/lib/api-utils";
import { getProjectDocument, deleteProjectDocument } from "@/services/project-documents";
import { fileResponseHeaders } from "@/lib/file-response";

/** GET — streams the file. ?download=1 forces the save dialog. */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ projectId: string; documentId: string }> },
) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized(req);
  const { projectId, documentId } = await params;

  const doc = await getProjectDocument(ctx.workspaceId, documentId);
  if (!doc || doc.projectId !== projectId) return notFound("Dokument nicht gefunden");

  const buffer = Buffer.from(doc.fileContent, "base64");
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
  { params }: { params: Promise<{ projectId: string; documentId: string }> },
) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized(req);
  const { projectId, documentId } = await params;

  const ok = await deleteProjectDocument(ctx.workspaceId, documentId, projectId);
  if (!ok) return notFound("Dokument nicht gefunden");
  return success({ deleted: true });
}
