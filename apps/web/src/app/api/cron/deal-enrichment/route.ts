import { NextRequest, NextResponse } from "next/server";
import { requireCronAuth } from "@/lib/cron-auth";
import { runDealEnrichmentCron } from "@/services/deal-enrichment";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * GET /api/cron/deal-enrichment
 *
 * Every few minutes: debounce queue plus a sweep of open deals with recent
 * messages or notes. Reads existing CRM text and may fill empty deal fields.
 * Never sends a customer message.
 */
export async function GET(req: NextRequest) {
  const denied = requireCronAuth(req);
  if (denied) return denied;

  try {
    const summary = await runDealEnrichmentCron(2);
    return NextResponse.json({ success: true, ...summary });
  } catch (err) {
    console.error("[cron/deal-enrichment]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "deal-enrichment failed" },
      { status: 500 }
    );
  }
}
