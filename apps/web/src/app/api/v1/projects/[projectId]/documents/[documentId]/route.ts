import { NextRequest, NextResponse } from "next/server";
import { getAuthContext, unauthorized, notFound, success } from "@/lib/api-utils";
import { getProjectDocument, deleteProjectDocument } from "@/services/project-documents";

/** GET — streams the file. ?download=1 forces the save dialog. */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ projectId: string; documentId: string }> },
) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();
  const { projectId, documentId } = await params;

  const doc = await getProjectDocument(ctx.workspaceId, documentId);
  if (!doc || doc.projectId !== projectId) return notFound("Dokument nicht gefunden");

  const buffer = Buffer.from(doc.fileContent, "base64");
  const wantDownload = req.nextUrl.searchParams.get("download") === "1";
  const disposition = wantDownload ? "attachment" : "inline";

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": doc.mimeType,
      "Content-Disposition": `${disposition}; filename="${encodeURIComponent(doc.fileName)}"`,
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
  if (!ctx) return unauthorized();
  const { projectId, documentId } = await params;

  const ok = await deleteProjectDocument(ctx.workspaceId, documentId, projectId);
  if (!ok) return notFound("Dokument nicht gefunden");
  return success({ deleted: true });
}
