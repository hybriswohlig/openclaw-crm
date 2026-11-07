// apps/web/src/app/api/tools/jobs/[id]/store-as-document/route.ts
//
// Pull the finished PDF from the crm-tools VPS and write it into dealDocuments
// in-process. Do NOT POST the bytes back through /api/v1/deals/:id/documents:
// that inbound hop hits Vercel's ~4.5 MB request-body limit and returns HTTP
// 413 with `{ error: "upload failed", upstream: {} }` (the platform HTML body
// is not JSON). MCP callers only send { jobId, recordId }; the PDF never
// travels through the MCP or Vercel request body.
//
// Body: { dealRecordId: string, documentType?: string, dueDate?: string }
// Der Typ kommt aus dem Job-Register; ein mitgeschickter documentType muss passen.
//
// Plan 5a: Jobs von `rechnungen-und-auftragsbestaetigungen` stehen im Job-Register
// (`document_render_jobs`). Abgelegt wird über `kvJobAbschliessen`, dieselbe Stelle
// wie im Cron, mit Reservierung (nie doppelt) und Versionsbezug beim KV. Ein Job
// ohne Eintrag, aus einem anderen Workspace, mit anderem Deal oder anderem Typ
// ergibt 404. Ausnahme: Auftragsanweisungen (eigener Skill, nicht im Register)
// laufen wie bisher, aber nur, wenn der VPS wirklich ein „AW-…“-PDF liefert.
import { NextRequest, NextResponse } from "next/server";
import { getAuthContext, unauthorized, badRequest } from "@/lib/api-utils";
import {
  createDealDocument,
  deduceDocumentType,
  parseFilenameFromContentDisposition,
  validateDealDocumentUpload,
} from "@/services/deal-documents";
import { jobLaden } from "@/services/render-jobs";
import { dealImWorkspace } from "@/lib/kalkulation-versionen-antwort";
import { kvJobAbschliessenDetails } from "@/services/kv-job-abschluss";

const CRM_TOOLS_API_URL = process.env.CRM_TOOLS_API_URL;
const CRM_TOOLS_AUTH_TOKEN = process.env.CRM_TOOLS_AUTH_TOKEN;

const nichtGefunden = () => NextResponse.json({ error: "Job nicht gefunden" }, { status: 404 });

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

  const job = await jobLaden(ctx.workspaceId, id);
  if (!job) return ohneRegister(ctx, id, body);
  if (job.dealRecordId !== body.dealRecordId) return nichtGefunden();
  if (body.documentType !== undefined && body.documentType !== job.documentType) return nichtGefunden();

  const r = await kvJobAbschliessenDetails(ctx.workspaceId, id, {
    faelligAm: body.dueDate ?? body.rechnungFaelligAm,
    updatedBy: ctx.userId,
  });
  const a = r.abschluss;
  switch (a.status) {
    case "abgelegt":
      return NextResponse.json({
        ...a,
        document: { data: r.dokument },
        deducedDocumentType: job.documentType,
        filename: r.dokument?.fileName,
        ...(r.dueDateWarning ? { dueDateWarning: r.dueDateWarning } : { rechnungFaelligAm: r.rechnungFaelligAm }),
      });
    case "schon_erledigt":
      return NextResponse.json(a);
    case "laeuft":
      return NextResponse.json(a, { status: 202 });
    case "verworfen":
      return NextResponse.json(
        {
          ...a,
          error: "KV verworfen: Die Kalkulation hat inzwischen eine andere Version. Bitte den KV neu erstellen.",
        },
        { status: 409 }
      );
    case "fehler":
      return NextResponse.json({ ...a, error: a.fehler }, { status: 502 });
  }
}

/** Bisheriger Weg, nur noch für Auftragsanweisungen (Skill `auftragsanweisung`). */
async function ohneRegister(
  ctx: { workspaceId: string },
  id: string,
  body: { dealRecordId?: string; documentType?: string }
) {
  if (!(await dealImWorkspace(ctx.workspaceId, body.dealRecordId!))) return nichtGefunden();
  if (body.documentType !== undefined && body.documentType !== "worker_instructions") return nichtGefunden();

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

  const filename = parseFilenameFromContentDisposition(upstream.headers.get("content-disposition"));
  if (!filename || deduceDocumentType(filename) !== "worker_instructions") return nichtGefunden();
  const bytes = Buffer.from(await upstream.arrayBuffer());
  const contentType = (upstream.headers.get("content-type") ?? "application/pdf").split(";")[0].trim();

  const check = validateDealDocumentUpload({
    fileName: filename,
    fileSize: bytes.length,
    documentType: "worker_instructions",
  });
  if (!check.ok) {
    return NextResponse.json({ error: check.error }, { status: check.status });
  }

  // Direkt einfügen, kein zweiter HTTP-Weg für das PDF.
  const uploaded = await createDealDocument({
    workspaceId: ctx.workspaceId,
    dealRecordId: body.dealRecordId!,
    documentType: check.documentType,
    fileName: filename,
    fileSize: bytes.length,
    mimeType: contentType || "application/pdf",
    fileContent: bytes.toString("base64"),
    calculationVersionId: null,
  });

  return NextResponse.json({
    status: "abgelegt",
    dealDocumentId: uploaded.id,
    document: { data: uploaded },
    deducedDocumentType: check.documentType,
    filename,
    rechnungFaelligAm: null,
  });
}
