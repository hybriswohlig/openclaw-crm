/**
 * Public visit-tracking beacon.
 *
 *   POST /api/public/[token]/track
 *
 * Body shape (see VisitBeaconInput in services/customer-portal-data.ts):
 *   {
 *     sessionId:      string  // UUID v4 from localStorage
 *     event:          "open" | "heartbeat"
 *     activeMsDelta:  number  // foreground-active ms since last beacon
 *     visibleMsDelta: number  // visible (incl. idle) ms since last beacon
 *     channel?:       string  // "share_panel" | "sms" | "whatsapp" | "email" | "unknown"
 *     referrer?:      string
 *     isMobile?:      boolean
 *     stageAtOpen?:   number  // 1..4
 *   }
 *
 * Errors never leak to the customer's UI — the client treats anything other
 * than 200 as "ignore and keep going".
 */
import { NextRequest, NextResponse } from "next/server";
import { recordVisitBeacon, type VisitBeaconInput } from "@/services/customer-portal-data";

export const runtime = "nodejs";
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

  let body: VisitBeaconInput;
  try {
    body = (await req.json()) as VisitBeaconInput;
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const result = await recordVisitBeacon(token, body, {
    ipAddress: clientIp(req),
    userAgent: req.headers.get("user-agent") ?? "",
  });

  if (!result.ok) {
    return NextResponse.json({ ok: false }, { status: 204 });
  }
  return NextResponse.json({ ok: true });
}
