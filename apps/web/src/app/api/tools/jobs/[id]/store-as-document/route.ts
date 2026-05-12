// apps/web/src/app/api/tools/jobs/[id]/store-as-document/route.ts
//
// Pull the result from FastAPI and write it into the CRM's dealDocuments
// table via the existing upload endpoint.
//
// Body: { dealRecordId: string, documentType?: "order_confirmation" | "invoice" | "payment_confirmation" }
//
// If documentType is omitted, it's deduced from the result filename:
//   "AB-…pdf" → order_confirmation
//   "RE-…pdf" → invoice
import { NextRequest, NextResponse } from "next/server";
import { getAuthContext, unauthorized, badRequest } from "@/lib/api-utils";

const CRM_TOOLS_API_URL = process.env.CRM_TOOLS_API_URL;
const CRM_TOOLS_AUTH_TOKEN = process.env.CRM_TOOLS_AUTH_TOKEN;

const VALID_DOCUMENT_TYPES = new Set([
  "order_confirmation",
  "invoice",
  "payment_confirmation",
]);

function deduceDocumentType(filename: string): string | null {
  if (filename.startsWith("AB-")) return "order_confirmation";
  if (filename.startsWith("RE-")) return "invoice";
  return null;
}

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

  // 1) Pull result from FastAPI
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

  const blob = await upstream.blob();
  const filename =
    parseFilenameFromContentDisposition(
      upstream.headers.get("content-disposition")
    ) || `document-${id}.pdf`;
  const contentType = upstream.headers.get("content-type") ?? "application/pdf";

  const documentType =
    body.documentType ?? deduceDocumentType(filename) ?? "order_confirmation";
  if (!VALID_DOCUMENT_TYPES.has(documentType)) {
    return badRequest(`invalid documentType: ${documentType}`);
  }

  // 2) POST as multipart to the CRM's own upload endpoint. Forward the session
  // cookie so the upload route's getAuthContext succeeds for the same user.
  const formData = new FormData();
  formData.append(
    "file",
    new File([blob], filename, { type: contentType })
  );
  formData.append("documentType", documentType);

  const cookie = req.headers.get("cookie") ?? "";
  const proto = req.headers.get("x-forwarded-proto") ?? "https";
  const host = req.headers.get("host");
  const uploadUrl = `${proto}://${host}/api/v1/deals/${encodeURIComponent(
    body.dealRecordId
  )}/documents`;

  const uploadResp = await fetch(uploadUrl, {
    method: "POST",
    headers: { cookie },
    body: formData,
  });

  const uploaded = await uploadResp.json().catch(() => ({}));
  if (!uploadResp.ok) {
    return NextResponse.json(
      { error: "upload failed", upstream: uploaded },
      { status: uploadResp.status }
    );
  }

  return NextResponse.json({
    document: uploaded,
    deducedDocumentType: documentType,
    filename,
  });
}

function parseFilenameFromContentDisposition(cd: string | null): string | null {
  if (!cd) return null;
  const match = /filename\*?=(?:UTF-8'')?\"?([^;\"\n]+)\"?/i.exec(cd);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}
