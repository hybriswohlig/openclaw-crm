import { NextRequest, NextResponse } from "next/server";
import { loadContextByToken } from "@/services/customer-portal-data";
import { portalSperre } from "@/lib/portal-preview";

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

  // Revoked/expired link or portal switched off: no customer data. The open
  // page reloads on 410 and then renders the matching notice.
  const sperre = portalSperre(ctx.meta);
  if (sperre) {
    return NextResponse.json(
      { error: { code: sperre === "revoked" ? "REVOKED" : "DISABLED" } },
      { status: 410 }
    );
  }

  // The JSON poll is not an open. Session beacons own the counter.
  return NextResponse.json({ data: ctx });
}
