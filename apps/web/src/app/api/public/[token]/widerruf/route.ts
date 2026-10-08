import { after, NextRequest, NextResponse } from "next/server";
import { parseWiderrufPayload } from "@openclaw-crm/customer-portal-core";
import { widerrufFuerToken } from "@/services/kva-widerruf";

export const dynamic = "force-dynamic";

function clientIp(req: NextRequest): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return req.headers.get("x-real-ip") ?? "0.0.0.0";
}

/** Elektronische Widerrufsfunktion (§ 356a BGB): „Widerruf bestätigen“ im Portal. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const raw = await req.json().catch(() => null);
  const body = parseWiderrufPayload(raw);
  if (!body) {
    return NextResponse.json({ error: { code: "BAD_REQUEST" } }, { status: 400 });
  }

  const result = await widerrufFuerToken(token, body, {
    ipAddress: clientIp(req),
    userAgent: req.headers.get("user-agent") ?? "",
  });
  if (!result.ok) {
    const status: Record<string, number> = {
      invalid_token: 400,
      not_found: 404,
      revoked: 410,
      keine_annahme: 409,
      frist_abgelaufen: 410,
      kanal_unavailable: 422,
    };
    return NextResponse.json({ error: { code: result.reason.toUpperCase() } }, { status: status[result.reason] ?? 422 });
  }

  // Eingangsbestätigung und Team-Alarm laufen nach der Antwort weiter.
  if (result.nachlauf) after(result.nachlauf);
  return NextResponse.json({ data: { eingegangenAt: result.eingegangenAt } });
}
