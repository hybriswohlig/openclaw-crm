/**
 * POST /api/public/[token]/set-email
 *
 * Lets the customer provide their own email when none is on file or only a
 * Kleinanzeigen relay address is. Writes to the people record's
 * `email_addresses` attribute as the new primary value. Idempotent.
 */
import { NextRequest, NextResponse } from "next/server";
import { recordCustomerEmail } from "@/services/customer-portal-data";

export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;

  let body: { email?: string };
  try {
    body = (await req.json()) as { email?: string };
  } catch {
    return NextResponse.json({ error: { code: "BAD_REQUEST" } }, { status: 400 });
  }
  if (typeof body.email !== "string" || !body.email.trim()) {
    return NextResponse.json({ error: { code: "MISSING_EMAIL" } }, { status: 400 });
  }

  const result = await recordCustomerEmail(token, body.email);
  if (!result.ok) {
    const status =
      result.reason === "not_found"
        ? 404
        : result.reason === "revoked"
          ? 410
          : result.reason === "invalid_token" || result.reason === "invalid_email"
            ? 400
            : 422;
    return NextResponse.json(
      { error: { code: result.reason.toUpperCase() } },
      { status }
    );
  }

  return NextResponse.json({
    data: { status: result.status, masked: result.masked },
  });
}
