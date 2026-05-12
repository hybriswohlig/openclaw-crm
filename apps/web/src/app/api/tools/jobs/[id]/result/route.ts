// apps/web/src/app/api/tools/jobs/[id]/result/route.ts
//
// Stream the result file from FastAPI to the browser. The browser can either
// download it (anchor href), or you can hit /store-as-document/ instead to
// have Vercel pull it and attach it to a deal in dealDocuments.
import { NextRequest, NextResponse } from "next/server";
import { getAuthContext, unauthorized } from "@/lib/api-utils";

const CRM_TOOLS_API_URL = process.env.CRM_TOOLS_API_URL;
const CRM_TOOLS_AUTH_TOKEN = process.env.CRM_TOOLS_AUTH_TOKEN;

export async function GET(
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
  const upstream = await fetch(
    `${CRM_TOOLS_API_URL}/jobs/${encodeURIComponent(id)}/result`,
    {
      headers: { Authorization: `Bearer ${CRM_TOOLS_AUTH_TOKEN}` },
    }
  );

  if (!upstream.ok || !upstream.body) {
    const text = await upstream.text().catch(() => "");
    return NextResponse.json(
      { error: "result fetch failed", detail: text },
      { status: upstream.status }
    );
  }

  // Pass through the content-type and disposition so the browser handles it
  // correctly (e.g. PDF inline preview, or download).
  const headers = new Headers();
  const ct = upstream.headers.get("content-type");
  const cd = upstream.headers.get("content-disposition");
  if (ct) headers.set("content-type", ct);
  if (cd) headers.set("content-disposition", cd);

  return new NextResponse(upstream.body, { status: 200, headers });
}
