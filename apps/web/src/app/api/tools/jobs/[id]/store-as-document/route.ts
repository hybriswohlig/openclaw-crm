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
import { applyInvoiceDueDate } from "@/services/rechnung-faellig";

const CRM_TOOLS_API_URL = process.env.CRM_TOOLS_API_URL;
const CRM_TOOLS_AUTH_TOKEN = process.env.CRM_TOOLS_AUTH_TOKEN;

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized(req);

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
    dueDate?: string;
    rechnungFaelligAm?: string;
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
  // Ohne Kalkulationsversion: /jobs/{id}/result liefert nur die PDF-Bytes, nicht die
  // Job-Parameter (`_calculation_version_id` aus attachDocumentJobContext). Welche
  // Version der VPS gerendert hat, ist hier unbekannt; die Quotation von jetzt kann
  // schon eine spätere sein.
  const uploaded = await createDealDocument({
    workspaceId: ctx.workspaceId,
    dealRecordId: body.dealRecordId,
    documentType: check.documentType,
    fileName: filename,
    fileSize: bytes.length,
    mimeType: contentType || "application/pdf",
    fileContent: bytes.toString("base64"),
    calculationVersionId: null,
  });

  // 3) On invoices: stamp the existing deal attribute "Rechnung fällig am"
  // with the upload day (Europe/Berlin, sofort). An explicit dueDate wins.
  // Same rule for every company — Ceylan has no separate code path.
  // The attribute already exists, so this is a value write, not a migration.
  // A failed stamp keeps the stored PDF and reports dueDateWarning.
  const due = await applyInvoiceDueDate({
    documentType: check.documentType,
    workspaceId: ctx.workspaceId,
    dealRecordId: body.dealRecordId,
    explicitDueDate: body.dueDate ?? body.rechnungFaelligAm,
    updatedBy: ctx.userId,
  });
  if (due.dueDateWarning) {
    return NextResponse.json({
      document: { data: uploaded },
      deducedDocumentType: documentType,
      filename,
      dueDateWarning: due.dueDateWarning,
    });
  }
  const dueDateSet = due.rechnungFaelligAm;

  return NextResponse.json({
    document: { data: uploaded },
    deducedDocumentType: documentType,
    filename,
    rechnungFaelligAm: dueDateSet,
  });
}
