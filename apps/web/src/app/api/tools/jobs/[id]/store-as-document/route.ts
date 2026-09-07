// apps/web/src/app/api/tools/jobs/[id]/store-as-document/route.ts
//
// Pull the finished PDF from the crm-tools VPS and write it into dealDocuments
// in-process. Do NOT POST the bytes back through /api/v1/deals/:id/documents:
// that inbound hop hits Vercel's ~4.5 MB request-body limit and returns HTTP
// 413 with `{ error: "upload failed", upstream: {} }` (the platform HTML body
// is not JSON). MCP callers only send { jobId, recordId }; the PDF never
// travels through the MCP or Vercel request body.
//
// Body: { dealRecordId: string, documentType?: "quotation" | "order_confirmation" | "invoice" | "payment_confirmation" | "worker_instructions" }
//
// If documentType is omitted, it's deduced from the result filename:
//   "KV-…pdf" / "MUSTER-KV-…pdf" → quotation
//   "AB-…pdf" → order_confirmation
//   "RE-…pdf" → invoice
//   "AW-…pdf" → worker_instructions
import { NextRequest, NextResponse } from "next/server";
import { getAuthContext, unauthorized, badRequest } from "@/lib/api-utils";
import {
  createDealDocument,
  deduceDocumentType,
  parseFilenameFromContentDisposition,
  validateDealDocumentUpload,
} from "@/services/deal-documents";

const CRM_TOOLS_API_URL = process.env.CRM_TOOLS_API_URL;
const CRM_TOOLS_AUTH_TOKEN = process.env.CRM_TOOLS_AUTH_TOKEN;

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();

  if (!CRM_TOOLS_API_URL || !CRM_TOOLS_AUTH_TOKEN) {
    return NextResponse.json(
      { error: "crm-tools env not configured" },
      { status: 500 }
    );
  }

  const { id } = await params;
  const body = (await req.json()) as {
    dealRecordId?: string;
    documentType?: string;
  };

  if (!body.dealRecordId) return badRequest("dealRecordId is required");

  // 1) Pull result from FastAPI (outbound fetch — not a Vercel body limit).
  const upstream = await fetch(
    `${CRM_TOOLS_API_URL}/jobs/${encodeURIComponent(id)}/result`,
    { headers: { Authorization: `Bearer ${CRM_TOOLS_AUTH_TOKEN}` } }
  );
  if (!upstream.ok) {
    const text = await upstream.text().catch(() => "");
    return NextResponse.json(
      { error: "result fetch failed", detail: text },
      { status: upstream.status }
    );
  }

  const bytes = Buffer.from(await upstream.arrayBuffer());
  const filename =
    parseFilenameFromContentDisposition(
      upstream.headers.get("content-disposition")
    ) || `document-${id}.pdf`;
  const contentType = (
    upstream.headers.get("content-type") ?? "application/pdf"
  )
    .split(";")[0]
    .trim();

  const documentType =
    body.documentType ?? deduceDocumentType(filename) ?? "order_confirmation";
  const check = validateDealDocumentUpload({
    fileName: filename,
    fileSize: bytes.length,
    documentType,
  });
  if (!check.ok) {
    return NextResponse.json({ error: check.error }, { status: check.status });
  }

  // 2) Insert directly. No self-HTTP upload of the PDF.
  const uploaded = await createDealDocument({
    workspaceId: ctx.workspaceId,
    dealRecordId: body.dealRecordId,
    documentType: check.documentType,
    fileName: filename,
    fileSize: bytes.length,
    mimeType: contentType || "application/pdf",
    fileContent: bytes.toString("base64"),
  });

  // 3) On invoices: stamp the deal's "Rechnung fällig am" attribute with
  // today + 7 days (Kottke standard; Ceylan stammdaten say "nach erfolgtem
  // Umzug" — the RE is by definition post-move, so 7d is a sensible
  // team-facing tracking date). The PDF itself still carries the legally
  // correct per-firma wording from the skill template.
  //
  // This PATCH is a few dozen bytes of JSON — well under the platform body
  // limit. We keep the existing records route so attribute validation stays
  // in one place.
  let dueDateSet: string | null = null;
  if (documentType === "invoice") {
    const due = new Date();
    due.setDate(due.getDate() + 7);
    dueDateSet = due.toISOString().slice(0, 10); // YYYY-MM-DD
    const proto = req.headers.get("x-forwarded-proto") ?? "https";
    const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
    const authHeaders: Record<string, string> = {
      "Content-Type": "application/json",
    };
    const cookie = req.headers.get("cookie");
    if (cookie) authHeaders.cookie = cookie;
    const authorization = req.headers.get("authorization");
    if (authorization) authHeaders.authorization = authorization;

    const patchUrl = `${proto}://${host}/api/v1/objects/deals/records/${encodeURIComponent(
      body.dealRecordId
    )}`;
    const patchResp = await fetch(patchUrl, {
      method: "PATCH",
      headers: authHeaders,
      body: JSON.stringify({ values: { rechnung_faellig_am: dueDateSet } }),
    });
    if (!patchResp.ok) {
      // Don't fail the whole request — the PDF is already attached and that's
      // the primary outcome. Surface the patch error in the response instead.
      const detail = await patchResp.text().catch(() => "");
      return NextResponse.json({
        document: { data: uploaded },
        deducedDocumentType: documentType,
        filename,
        dueDateWarning: `failed to set rechnung_faellig_am: ${detail}`,
      });
    }
  }

  return NextResponse.json({
    document: { data: uploaded },
    deducedDocumentType: documentType,
    filename,
    rechnungFaelligAm: dueDateSet,
  });
}
