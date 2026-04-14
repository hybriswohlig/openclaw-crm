import { NextRequest, NextResponse } from "next/server";
import { syncAllEmailAccountsGlobal } from "@/services/inbox-email";

// Runs on the Vercel cron schedule defined in vercel.json (every 5 minutes).
// Vercel cron requests include an Authorization: Bearer <CRON_SECRET> header
// when CRON_SECRET is set in project env — we verify it to reject strangers.
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }

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
