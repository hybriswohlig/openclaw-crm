/**
 * Public package-selection endpoint.
 *
 *   POST /api/public/[token]/select-package
 *   body: { slug: string }
 *
 * Validates the slug belongs to the deal's operating company and writes
 * the choice onto the quotation. When the package carries a fixed
 * price, we also mirror the price into quotations.fixed_price so the
 * customer's price card updates immediately. Server emits a
 * customer.package_selected activity event so the operator sees the
 * change on the deal timeline.
 *
 * Locked once a kva acceptance exists for the deal — picking a
 * different tier after binding would silently change the signed price.
 */
import { NextRequest, NextResponse } from "next/server";
import { selectPackageForToken } from "@/services/customer-portal-data";

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

  let body: { slug: string };
  try {
    body = (await req.json()) as { slug: string };
  } catch {
    return NextResponse.json(
      { error: { code: "BAD_REQUEST" } },
      { status: 400 }
    );
  }
  if (typeof body.slug !== "string" || !body.slug) {
    return NextResponse.json(
      { error: { code: "BAD_REQUEST" } },
      { status: 400 }
    );
  }

  const result = await selectPackageForToken(token, body, {
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
