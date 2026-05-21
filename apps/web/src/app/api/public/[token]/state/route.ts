import { NextRequest, NextResponse } from "next/server";
import { bumpView, loadContextByToken } from "@/services/customer-portal-data";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const ctx = await loadContextByToken(token);
  if (!ctx) {
    return NextResponse.json({ error: { code: "NOT_FOUND" } }, { status: 404 });
  }

  // Fire-and-forget view bump — never blocks the response.
  bumpView(token).catch(() => {});

  return NextResponse.json({ data: ctx });
}
