/**
 * Phase-0 repair for the 2026-06-03 agent incident: drain stale aiNeedsReply flags.
 *
 * Conversations that carried ai_needs_reply=true from BEFORE the agent existed
 * caused the agent to blast the whole backlog when it was first enabled. This
 * one-shot (re-runnable, idempotent) script finds conversations where
 *
 *   ai_needs_reply = true
 *   AND (ai_last_inbound_at IS NULL OR ai_last_inbound_at < now() - interval '48 hours')
 *
 * DRY-RUN by default — prints the affected rows and changes nothing.
 * --apply clears ai_needs_reply on exactly those rows in one UPDATE.
 * Rows with fresh inbound (<48h) are never touched: the same predicate is
 * re-evaluated inside the UPDATE itself (cutoff computed in Postgres, not JS).
 *
 * Run:
 *   pnpm --filter @openclaw-crm/web agent:drain-stale            # dry run
 *   pnpm --filter @openclaw-crm/web agent:drain-stale --apply    # clear flags
 */
import "./_load-env";
import { db } from "@/db";
import { channelAccounts, inboxConversations } from "@/db/schema";
import { and, eq, isNull, lt, or, sql } from "drizzle-orm";

const APPLY = process.argv.includes("--apply");

// Cutoff is computed inside Postgres — never interpolate a JS Date into sql``
// (incident 0214e35).
const STALE_CUTOFF = sql`now() - interval '48 hours'`;

const staleWhere = and(
  eq(inboxConversations.aiNeedsReply, true),
  or(
    isNull(inboxConversations.aiLastInboundAt),
    lt(inboxConversations.aiLastInboundAt, STALE_CUTOFF),
  ),
);

function truncatePreview(preview: string | null): string {
  if (!preview) return "";
  const flat = preview.replace(/\s+/g, " ").trim();
  return flat.length > 60 ? `${flat.slice(0, 59)}…` : flat;
}

async function main() {
  console.log(`\n=== Drain stale aiNeedsReply — ${APPLY ? "APPLY" : "DRY-RUN"} ===`);

  const rows = await db
    .select({
      id: inboxConversations.id,
      channelAccount: channelAccounts.name,
      lane: inboxConversations.lane,
      lastInboundAt: inboxConversations.aiLastInboundAt,
      preview: inboxConversations.lastMessagePreview,
    })
    .from(inboxConversations)
    .innerJoin(channelAccounts, eq(inboxConversations.channelAccountId, channelAccounts.id))
    .where(staleWhere)
    .orderBy(inboxConversations.aiLastInboundAt);

  if (rows.length === 0) {
    console.log("No stale aiNeedsReply conversations found. Nothing to do.");
    return;
  }

  console.table(
    rows.map((r) => ({
      id: r.id,
      "channel account": r.channelAccount,
      lane: r.lane,
      "last inbound at": r.lastInboundAt ? r.lastInboundAt.toISOString() : "NULL",
      "last message": truncatePreview(r.preview),
    })),
  );
  console.log(`Total stale conversations: ${rows.length}`);

  if (!APPLY) {
    console.log("Dry run — nothing changed. Re-run with --apply to clear these flags.");
    return;
  }

  // One UPDATE, same predicate re-evaluated in the DB: a conversation that
  // received fresh inbound between the SELECT and now is left untouched.
  const cleared = await db
    .update(inboxConversations)
    .set({ aiNeedsReply: false })
    .where(staleWhere)
    .returning({ id: inboxConversations.id });

  console.log(`Cleared aiNeedsReply on ${cleared.length} conversation(s).`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("drain-stale-ai-needs-reply failed:", err);
    process.exit(1);
  });
