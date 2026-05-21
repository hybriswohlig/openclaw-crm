import { NextRequest, NextResponse } from "next/server";
import { recordMarkedPaid } from "@/services/customer-portal-data";

export const dynamic = "force-dynamic";

function clientIp(req: NextRequest): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return req.headers.get("x-real-ip") ?? "0.0.0.0";
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  let body: { method?: string; amountCents?: number; variant?: "deposit" | "final" };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: { code: "BAD_REQUEST" } }, { status: 400 });
  }

  const method = typeof body.method === "string" ? body.method : "bank_transfer";
  const amountCents = Number(body.amountCents);
  const variant = body.variant === "deposit" ? "deposit" : "final";

  if (!Number.isFinite(amountCents) || amountCents < 0) {
    return NextResponse.json({ error: { code: "BAD_AMOUNT" } }, { status: 400 });
  }

  const result = await recordMarkedPaid(
    token,
    { method, amountCents, variant },
    { ipAddress: clientIp(req), userAgent: req.headers.get("user-agent") ?? "" }
  );

  if (!result.ok) {
    const status = result.reason === "not_found" ? 404 : result.reason === "revoked" ? 410 : 400;
    return NextResponse.json({ error: { code: result.reason.toUpperCase() } }, { status });
  }
  return NextResponse.json({ data: { ok: true } });
}
