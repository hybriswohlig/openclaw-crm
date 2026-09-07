import { NextRequest, NextResponse } from "next/server";
import { emailPortalDocument } from "@/services/customer-portal-data";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string; id: string }> }) {
  const origin = req.headers.get("origin");
  if (origin && origin !== req.nextUrl.origin) return NextResponse.json({ error: { code: "FORBIDDEN" } }, { status: 403 });
  const { token, id } = await params;
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(id)) return NextResponse.json({ error: { code: "DOCUMENT_UNAVAILABLE" } }, { status: 400 });
  try {
    const result = await emailPortalDocument(token, id);
    if (!result.ok) return NextResponse.json({ error: { code: result.reason.toUpperCase() } }, {
      status: result.reason === "rate_limited" ? 429 : result.reason === "unavailable" || result.reason === "document_unavailable" ? 404 : result.reason === "send_failed" ? 502 : 422,
    });
    return NextResponse.json({ data: { status: "sent" } });
  } catch {
    return NextResponse.json({ error: { code: "SEND_FAILED" } }, { status: 503 });
  }
}
