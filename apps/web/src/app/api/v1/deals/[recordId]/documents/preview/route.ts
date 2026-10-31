import { NextRequest, NextResponse } from "next/server";
import { badRequest, getAuthContext, success, unauthorized } from "@/lib/api-utils";
import { parseKind, parsePreviewBody, type PreviewFormat } from "@/lib/commercial-document-request";
import {
  CommercialDocumentError,
  previewCommercialDocument,
  type RenderedCommercialDocument,
} from "@/services/commercial-documents";

export const runtime = "nodejs";
export const maxDuration = 30;

function documentError(err: unknown) {
  if (err instanceof CommercialDocumentError) {
    return NextResponse.json(
      { error: { code: err.code, message: err.message } },
      { status: err.status }
    );
  }
  console.error("[documents/preview]", err);
  return NextResponse.json(
    { error: { code: "RENDER_FAILED", message: "Vorschau konnte nicht erzeugt werden." } },
    { status: 500 }
  );
}

function previewResponse(format: PreviewFormat, rendered: RenderedCommercialDocument) {
  if (format === "pdf") {
    return new NextResponse(Buffer.from(rendered.pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${rendered.fileName}"`,
        "Cache-Control": "private, no-store",
        "X-Template-Version": rendered.templateVersion,
      },
    });
  }
  if (format === "json") {
    return success({
      html: rendered.html,
      templateVersion: rendered.templateVersion,
      fileName: rendered.fileName,
      documentType: rendered.model.kind,
    });
  }
  return new NextResponse(rendered.html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "private, no-store",
      "X-Template-Version": rendered.templateVersion,
    },
  });
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ recordId: string }> }
) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized(req);
  const { recordId } = await params;
  const kind = parseKind(req.nextUrl.searchParams.get("documentType"));
  if (!kind) return badRequest("documentType must be KV, AB or RE");
  const formatParam = req.nextUrl.searchParams.get("format") ?? "html";
  const format = formatParam === "pdf" || formatParam === "json" ? formatParam : formatParam === "html" ? "html" : null;
  if (!format) return badRequest("format must be html, pdf or json");

  try {
    const rendered = await previewCommercialDocument({
      workspaceId: ctx.workspaceId,
      dealRecordId: recordId,
      kind,
    });
    return previewResponse(format, rendered);
  } catch (err) {
    return documentError(err);
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ recordId: string }> }
) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized(req);
  const { recordId } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest("Invalid JSON body");
  }
  const parsed = parsePreviewBody(body);
  if (!parsed.ok) {
    return NextResponse.json(
      { error: { code: parsed.code, message: parsed.error } },
      { status: parsed.status }
    );
  }

  try {
    const rendered = await previewCommercialDocument({
      workspaceId: ctx.workspaceId,
      dealRecordId: recordId,
      kind: parsed.value.kind,
      copy: parsed.value.copy,
      options: parsed.value.options,
    });
    return previewResponse(parsed.value.format, rendered);
  } catch (err) {
    return documentError(err);
  }
}
