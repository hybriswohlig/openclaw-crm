import { NextRequest, NextResponse } from "next/server";
import { confirmKvaForToken } from "@/services/customer-portal-data";
import type { ConfirmKvaPayload } from "@openclaw-crm/customer-portal-core";

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

  let body: ConfirmKvaPayload;
  try {
    body = (await req.json()) as ConfirmKvaPayload;
  } catch {
    return NextResponse.json(
      { error: { code: "BAD_REQUEST", message: "Invalid JSON body" } },
      { status: 400 }
    );
  }

  const result = await confirmKvaForToken(token, body, {
    ipAddress: clientIp(req),
    userAgent: req.headers.get("user-agent") ?? "",
  });

  if (!result.ok) {
    const status =
      result.reason === "not_found"
        ? 404
        : result.reason === "revoked" || result.reason === "offer_expired"
          ? 410
          : result.reason === "invalid_token"
            ? 400
            : 422;
    return NextResponse.json(
      { error: { code: result.reason.toUpperCase() } },
      { status }
    );
  }

  return NextResponse.json({ data: { ok: true } });
}
