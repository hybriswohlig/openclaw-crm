import { NextRequest, NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { mirrorSlotsForRecentDeals } from "@/services/agent/slot-mirror";
import { requireCronAuth } from "@/lib/cron-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * GET /api/cron/agent-shadow-sync
 *
 * Phase-1 SHADOW MODE: mirrors the latest KI-Analyse extraction results
 * (`ai.insights_extracted` events + the deal/Auftrag values they were applied
 * to) into the typed `qualification_slots` table, so slot coverage/accuracy
 * can be measured before the agent acts on it. Writes ONLY qualification_slots
 * — never deal EAV values, never engine state. Idempotent, safe every tick.
 *
 * Fail-closed Bearer auth via CRON_SECRET.
 */
export async function GET(req: NextRequest) {
  const denied = requireCronAuth(req);
  if (denied) return denied;

  try {
    const started = Date.now();
    const wsRows = (await db.execute<{ id: string }>(
      sql`SELECT id FROM workspaces`
    )) as unknown as Array<{ id: string }>;

    let deals = 0;
    let slotsWritten = 0;
    for (const w of wsRows) {
      const res = await mirrorSlotsForRecentDeals(w.id);
      deals += res.deals;
      slotsWritten += res.slotsWritten;
    }

    const elapsedMs = Date.now() - started;
    if (slotsWritten > 0) {
      console.log(
        `[cron/agent-shadow-sync] done in ${elapsedMs}ms — deals=${deals} slotsWritten=${slotsWritten}`
      );
    }
    return NextResponse.json({
      success: true,
      elapsedMs,
      workspaces: wsRows.length,
      deals,
      slotsWritten,
    });
  } catch (err) {
    console.error("[cron/agent-shadow-sync]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "agent-shadow-sync failed" },
      { status: 500 }
    );
  }
}
