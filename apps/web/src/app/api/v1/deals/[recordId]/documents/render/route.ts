import { NextRequest, NextResponse } from "next/server";
import { getAuthContext, success, unauthorized } from "@/lib/api-utils";
import { parseRenderBody } from "@/lib/commercial-document-request";
import {
  CommercialDocumentError,
  storeCommercialDocument,
} from "@/services/commercial-documents";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * CRM-side KV/AB/RE render. Refuses unless renderer is "crm", so the VPS
 * job (POST /api/tools/run) stays the default.
 * notifyCustomer defaults to false: storing from this path sends nothing.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ recordId: string }> }
) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();
  const { recordId } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: { code: "BAD_REQUEST", message: "Invalid JSON body" } },
      { status: 400 }
    );
  }

  const parsed = parseRenderBody(body);
  if (!parsed.ok) {
    return NextResponse.json(
      { error: { code: parsed.code, message: parsed.error } },
      { status: parsed.status }
    );
  }

  try {
    const stored = await storeCommercialDocument({
      workspaceId: ctx.workspaceId,
      dealRecordId: recordId,
      kind: parsed.value.kind,
      copy: parsed.value.copy,
      notifyCustomer: parsed.value.notifyCustomer,
    });
    return success({
      renderer: "crm",
      templateVersion: stored.templateVersion,
      fileName: stored.fileName,
      document: stored.document,
    });
  } catch (err) {
    if (err instanceof CommercialDocumentError) {
      return NextResponse.json(
        { error: { code: err.code, message: err.message } },
        { status: err.status }
      );
    }
    console.error("[documents/render]", err);
    return NextResponse.json(
      { error: { code: "RENDER_FAILED", message: "Dokument konnte nicht erzeugt werden." } },
      { status: 500 }
    );
  }
}
