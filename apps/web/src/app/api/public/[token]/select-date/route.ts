/**
 * Public date-offer selection endpoint.
 *
 *   POST /api/public/[token]/select-date
 *   body: { dateOfferId: string; slotIndex: number }
 *
 * Writes the customer's pick, mirrors the chosen date onto the deal's
 * `move_date` attribute, and emits an activity event. Server re-validates
 * that the offer belongs to the token's deal so a customer can't pick a
 * date from another lead.
 */
import { NextRequest, NextResponse } from "next/server";
import { selectDateOffer } from "@/services/customer-portal-data";

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

  let body: { dateOfferId: string; slotIndex: number };
  try {
    body = (await req.json()) as { dateOfferId: string; slotIndex: number };
  } catch {
    return NextResponse.json(
      { error: { code: "BAD_REQUEST" } },
      { status: 400 }
    );
  }

  if (
    typeof body.dateOfferId !== "string" ||
    typeof body.slotIndex !== "number"
  ) {
    return NextResponse.json(
      { error: { code: "BAD_REQUEST" } },
      { status: 400 }
    );
  }

  const result = await selectDateOffer(token, body, {
    ipAddress: clientIp(req),
    userAgent: req.headers.get("user-agent") ?? "",
  });

  if (!result.ok) {
    const status =
      result.reason === "not_found"
        ? 404
        : result.reason === "revoked"
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
