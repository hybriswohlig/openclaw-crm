/**
 * Shadow-draft viewer for the Phase-1 soak period: prints what the agent
 * WOULD have sent, newest first, with gate verdict and price-scan flag.
 * Read-only. The Phase-2 approval queue replaces this with an inbox UI.
 *
 *   pnpm agent:drafts [--days N] [--full] [--limit N]
 */
import "./_load-env";
import { db } from "@/db";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { agentDrafts } from "@/db/schema/agent";
import { inboxConversations, channelAccounts } from "@/db/schema/inbox";

function argNum(flag: string, dflt: number): number {
  const i = process.argv.indexOf(flag);
  if (i === -1) return dflt;
  const n = Number.parseInt(process.argv[i + 1], 10);
  return Number.isFinite(n) && n > 0 ? n : dflt;
}
const DAYS = argNum("--days", 7);
const LIMIT = argNum("--limit", 50);
const FULL = process.argv.includes("--full");

async function main(): Promise<void> {
  const rows = await db
    .select({
      id: agentDrafts.id,
      createdAt: agentDrafts.createdAt,
      messageClass: agentDrafts.messageClass,
      dealRecordId: agentDrafts.dealRecordId,
      draftText: agentDrafts.draftText,
      finalText: agentDrafts.finalText,
      filterVerdicts: agentDrafts.filterVerdicts,
      gateResults: agentDrafts.gateResults,
      status: agentDrafts.status,
      accountName: channelAccounts.name,
      preview: inboxConversations.lastMessagePreview,
    })
    .from(agentDrafts)
    .leftJoin(inboxConversations, eq(inboxConversations.id, agentDrafts.conversationId))
    .leftJoin(channelAccounts, eq(channelAccounts.id, inboxConversations.channelAccountId))
    .where(
      and(
        eq(agentDrafts.promptVersion, "shadow-v1"),
        gte(agentDrafts.createdAt, sql`now() - (${String(DAYS)} || ' days')::interval`)
      )
    )
    .orderBy(desc(agentDrafts.createdAt))
    .limit(LIMIT);

  if (rows.length === 0) {
    console.log(`No shadow drafts in the last ${DAYS} day(s). (Engines draft only when a lead-lane customer writes.)`);
    process.exit(0);
  }

  console.log(`=== ${rows.length} shadow draft(s), last ${DAYS} day(s), newest first ===\n`);
  for (const r of rows) {
    const gate = (r.gateResults ?? null) as { allowed?: boolean; reasons?: string[] } | null;
    const filters = (r.filterVerdicts ?? null) as { priceOrCommitmentLeak?: boolean } | null;
    const text = (r.finalText?.trim() || r.draftText).trim();
    const shown = FULL ? text : text.length > 220 ? `${text.slice(0, 220)}…` : text;
    console.log(
      `[${r.createdAt.toISOString()}] ${r.messageClass} | ${r.accountName ?? "(no thread)"} | status=${r.status}` +
        (filters?.priceOrCommitmentLeak ? "  ⚠ PRICE-SCAN HIT" : "")
    );
    console.log(`  gate: ${gate ? (gate.allowed ? "would allow" : `blocks (${(gate.reasons ?? []).join(", ")})`) : "n/a"}`);
    if (r.preview) console.log(`  customer last: ${r.preview.slice(0, 100)}`);
    console.log(`  draft: ${shown.replace(/\n/g, "\n         ")}`);
    console.log(`  deal:  ${r.dealRecordId}  draft-id: ${r.id}\n`);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error("list-drafts failed:", err);
  process.exit(1);
});
