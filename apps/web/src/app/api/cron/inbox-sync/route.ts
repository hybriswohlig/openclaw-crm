import { NextRequest, NextResponse } from "next/server";
import { syncAllEmailAccountsGlobal } from "@/services/inbox-email";
import { requireCronAuth } from "@/lib/cron-auth";

// Runs on the Vercel cron schedule defined in vercel.json (every 1 minute).
// Fail-closed Bearer auth via CRON_SECRET (requireCronAuth).
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const denied = requireCronAuth(req);
  if (denied) return denied;

  try {
    const result = await syncAllEmailAccountsGlobal();
    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    console.error("[cron/inbox-sync]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "sync failed" },
      { status: 500 }
    );
  }
}
