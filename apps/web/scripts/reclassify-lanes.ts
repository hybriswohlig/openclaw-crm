/**
 * Phase 6: reclassify EXISTING email conversations into lanes (KOT-IDENTITY).
 * Moves marketing / newsletters / platform notifications (Kleinanzeigen catch-all,
 * Google, AliExpress, Facebook…) out of the lead inbox into the Info lane, based
 * on each conversation's latest inbound message headers + sender + subject.
 *
 * DRY-RUN by default; --apply to write. Only touches conversations still in the
 * default 'lead' lane (never overrides a manual reclassification). Reversible
 * (set lane back to 'lead').
 *
 * Run: NODE_ENV=production DATABASE_URL=... pnpm --filter @openclaw-crm/web exec tsx scripts/reclassify-lanes.ts [--apply]
 */
import "./_load-env";
import { db } from "@/db";
import { channelAccounts, inboxConversations, inboxContacts, inboxMessages } from "@/db/schema";
import { and, eq, desc } from "drizzle-orm";
import { classifyInbound, classifyMessagingBody } from "@/services/inbox-triage";
import { cleanupNoiseDeal } from "@/services/inbox";

const APPLY = process.argv.includes("--apply");

async function main() {
  console.log(`\n=== Lane reclassification — ${APPLY ? "APPLY" : "DRY-RUN"} ===`);
  const accounts = await db.select({ id: channelAccounts.id, channelType: channelAccounts.channelType, workspaceId: channelAccounts.workspaceId }).from(channelAccounts);
  if (accounts.length === 0) { console.log("no channel accounts"); process.exit(0); }

  let moved = 0, kept = 0, dealsDeleted = 0;
  const byReason = new Map<string, number>();
  const examples: string[] = [];

  for (const acc of accounts) {
    const convs = await db
      .select({ id: inboxConversations.id, lane: inboxConversations.lane, subject: inboxConversations.subject, contactName: inboxContacts.displayName })
      .from(inboxConversations)
      .innerJoin(inboxContacts, eq(inboxConversations.contactId, inboxContacts.id))
      .where(and(eq(inboxConversations.channelAccountId, acc.id), eq(inboxConversations.lane, "lead")));
    for (const c of convs) {
      const [msg] = await db
        .select({ rawHeaders: inboxMessages.rawHeaders, fromAddress: inboxMessages.fromAddress, subject: inboxMessages.subject, body: inboxMessages.body })
        .from(inboxMessages)
        .where(and(eq(inboxMessages.conversationId, c.id), eq(inboxMessages.direction, "inbound")))
        .orderBy(desc(inboxMessages.sentAt))
        .limit(1);
      if (!msg) { kept++; continue; }
      let headers: Record<string, unknown> = {};
      if (msg.rawHeaders) { try { headers = JSON.parse(msg.rawHeaders); } catch { /* ignore */ } }
      const res = acc.channelType === "email"
        ? classifyInbound({ headers, fromAddr: msg.fromAddress, subject: msg.subject ?? c.subject, body: msg.body })
        : classifyMessagingBody(msg.body, c.contactName);
      if (res.lane === "lead") { kept++; continue; }
      moved++;
      byReason.set(res.reason, (byReason.get(res.reason) ?? 0) + 1);
      if (examples.length < 12) examples.push(`  ${res.lane.toUpperCase()}  <${msg.fromAddress}>  "${(msg.subject ?? "").slice(0, 50)}"  [${res.reason}]`);
      if (APPLY) {
        await db.update(inboxConversations).set({ lane: res.lane, classificationReason: res.reason, classifiedBy: res.by, aiNeedsReply: false, updatedAt: new Date() }).where(eq(inboxConversations.id, c.id));
        // Unberuehrten Auto-Deal der Noise-Konversation aufraeumen (Guards im Service).
        const cleanup = await cleanupNoiseDeal({ workspaceId: acc.workspaceId, conversationId: c.id });
        if (cleanup.action === "deleted") dealsDeleted++;
      }
    }
  }

  console.log(`\nemail conversations in 'lead' lane reviewed: ${moved + kept}`);
  console.log(`  -> would move OUT of lead (to info/spam): ${moved}`);
  console.log(`  -> stay as lead: ${kept}`);
  console.log(`\nby reason:`);
  for (const [reason, n] of [...byReason.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${n}\t${reason}`);
  console.log(`\nexamples:`);
  for (const e of examples) console.log(e);
  if (APPLY) console.log(`\nNoise-Deals soft-geloescht: ${dealsDeleted}`);
  console.log(`\n${APPLY ? "APPLIED." : "DRY-RUN — nothing changed. Re-run with --apply."}\n`);
  process.exit(0);
}

main().catch((e) => { console.error("fatal:", e); process.exit(1); });
