/**
 * Public visit-tracking beacon.
 *
 *   POST /api/public/[token]/track
 *
 * Body shape (see VisitBeaconInput in services/portal-visit-tracking.ts):
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
 * Link-preview crawlers and HEAD requests are ignored. A logged-in CRM
 * session is stored as internal. Errors never leak to the customer's UI.
 */
import { NextRequest, NextResponse } from "next/server";
import { shouldRecordPortalHit } from "@/lib/portal-open-tracking";
import {
  awaitPortalTracking,
  crmUserIdFromRequest,
  recordVisitBeacon,
  type VisitBeaconInput,
} from "@/services/portal-visit-tracking";

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
  const userAgent = req.headers.get("user-agent") ?? "";
  if (!shouldRecordPortalHit({ method: req.method, userAgent })) {
    return NextResponse.json({ ok: true, skipped: true });
  }

  let body: VisitBeaconInput;
  try {
    body = (await req.json()) as VisitBeaconInput;
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  try {
    const crmUserId = await crmUserIdFromRequest(req);
    const result = await awaitPortalTracking(
      recordVisitBeacon(token, body, {
        ipAddress: clientIp(req),
        userAgent,
        crmUserId,
        method: req.method,
      })
    );
    if (!result || !result.ok) {
      return NextResponse.json({ ok: false }, { status: 204 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[portal-tracking] beacon", err);
    return NextResponse.json({ ok: true });
  }
}
