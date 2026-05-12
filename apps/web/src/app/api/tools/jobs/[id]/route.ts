// apps/web/src/app/api/tools/jobs/[id]/route.ts
//
// Poll job status. Returns the FastAPI's response unchanged.
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
    `${CRM_TOOLS_API_URL}/jobs/${encodeURIComponent(id)}`,
    {
      headers: { Authorization: `Bearer ${CRM_TOOLS_AUTH_TOKEN}` },
      cache: "no-store",
    }
  );

  const data = await upstream.json().catch(() => ({}));
  return NextResponse.json(data, { status: upstream.status });
}
