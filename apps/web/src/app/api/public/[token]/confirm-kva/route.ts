import { after, NextRequest, NextResponse } from "next/server";
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
    const status: Record<string, number> = {
      not_found: 404,
      revoked: 410,
      offer_expired: 410,
      invalid_token: 400,
      price_changed: 409,
      agb_unavailable: 503,
    };
    return NextResponse.json(
      { error: { code: result.reason.toUpperCase() } },
      { status: status[result.reason] ?? 422 }
    );
  }

  // Bestätigung an den Kunden und Team-Alarm laufen nach der Antwort weiter.
  if (result.nachlauf) after(result.nachlauf);

  return NextResponse.json({ data: { ok: true } });
}
