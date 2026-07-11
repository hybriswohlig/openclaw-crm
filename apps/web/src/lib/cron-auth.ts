import { NextRequest, NextResponse } from "next/server";

/**
 * Fail-closed cron auth. Vercel Cron injects `Authorization: Bearer <CRON_SECRET>`
 * when CRON_SECRET is set. Missing secret or wrong bearer → reject (never open).
 */
export function requireCronAuth(req: NextRequest): NextResponse | null {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "cron_secret_not_configured" },
      { status: 500 }
    );
  }
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return null;
}
