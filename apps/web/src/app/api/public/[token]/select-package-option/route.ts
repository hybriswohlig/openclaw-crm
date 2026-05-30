/**
 * Public per-deal package-option selection.
 *
 *   POST /api/public/[token]/select-package-option
 *   body: { optionId: string }
 *
 * Validates the option belongs to the token's deal and writes the choice.
 * The option's `priceCents` is mirrored into quotations.fixed_price so the
 * customer's price card reads the picked tier on next render. Locked
 * once a kva_confirmation exists for the deal (returns 409).
 */
import { NextRequest, NextResponse } from "next/server";
import { selectDealPackageOptionForToken } from "@/services/customer-portal-data";

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

  let body: { optionId: string };
  try {
    body = (await req.json()) as { optionId: string };
  } catch {
    return NextResponse.json(
      { error: { code: "BAD_REQUEST" } },
      { status: 400 }
    );
  }
  if (typeof body.optionId !== "string" || !body.optionId) {
    return NextResponse.json(
      { error: { code: "BAD_REQUEST" } },
      { status: 400 }
    );
  }

  const result = await selectDealPackageOptionForToken(token, body, {
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
            : result.reason === "already_accepted"
              ? 409
              : 422;
    return NextResponse.json(
      { error: { code: result.reason.toUpperCase() } },
      { status }
    );
  }
  return NextResponse.json({ data: { ok: true } });
}
