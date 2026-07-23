/**
 * Phase-0 backfill (docs/ai-sales-agent-plan.md §6.1): mark deals as
 * human-owned when an operator sent an outbound message on any of their
 * conversations recently. Sticky by design — only the explicit UI release
 * clears it. Idempotent; safe to re-run.
 *
 * Dry-run by default; pass --apply to write.
 *   pnpm agent:backfill-human-owned [--apply] [--days 14]
 */
import "./_load-env";
import { db } from "@/db";
import { and, eq, gte, inArray, isNotNull, sql } from "drizzle-orm";
import { inboxConversations, inboxMessages } from "@/db/schema/inbox";
import { dealAgentState } from "@/db/schema/agent";
import { workspaces } from "@/db/schema/workspace";

const APPLY = process.argv.includes("--apply");
const daysArg = process.argv.indexOf("--days");
const DAYS = daysArg > -1 ? Number.parseInt(process.argv[daysArg + 1], 10) || 14 : 14;

async function main(): Promise<void> {
  const allWorkspaces = await db.select({ id: workspaces.id }).from(workspaces);
  let total = 0;
  for (const ws of allWorkspaces) {
    // Deals whose conversations carry an operator outbound within the window.
    // The cutoff is computed in Postgres (never interpolate a JS Date into sql``).
    const rows = await db
      .selectDistinct({ dealRecordId: inboxConversations.dealRecordId })
      .from(inboxMessages)
      .innerJoin(
        inboxConversations,
        eq(inboxConversations.id, inboxMessages.conversationId)
      )
      .where(
        and(
          eq(inboxConversations.workspaceId, ws.id),
          isNotNull(inboxConversations.dealRecordId),
          eq(inboxMessages.direction, "outbound"),
          gte(
            inboxMessages.sentAt,
            sql`now() - (${String(DAYS)} || ' days')::interval`
          )
        )
      );
    const dealIds = rows
      .map((r) => r.dealRecordId)
      .filter((id): id is string => Boolean(id));
    if (dealIds.length === 0) continue;

    const existing = await db
      .select({ id: dealAgentState.dealRecordId, humanOwned: dealAgentState.humanOwned })
      .from(dealAgentState)
      .where(inArray(dealAgentState.dealRecordId, dealIds));
    const alreadyOwned = new Set(existing.filter((e) => e.humanOwned).map((e) => e.id));
    const toSet = dealIds.filter((id) => !alreadyOwned.has(id));

    console.log(
      `[${ws.id}] operator-outbound deals (last ${DAYS}d): ${dealIds.length}, ` +
        `already human_owned: ${alreadyOwned.size}, to set: ${toSet.length}`
    );
    total += toSet.length;
    if (!APPLY || toSet.length === 0) continue;

    for (const dealRecordId of toSet) {
      await db
        .insert(dealAgentState)
        .values({
          dealRecordId,
          workspaceId: ws.id,
          humanOwned: true,
          humanOwnedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: dealAgentState.dealRecordId,
          set: { humanOwned: true, humanOwnedAt: new Date(), updatedAt: new Date() },
        });
    }
    console.log(`[${ws.id}] wrote ${toSet.length} human_owned rows`);
  }
  console.log(APPLY ? `Done: ${total} deals marked human_owned.` : `DRY RUN: would mark ${total} deals. Re-run with --apply.`);
  process.exit(0);
}

main().catch((err) => {
  console.error("backfill-human-owned failed:", err);
  process.exit(1);
});
