/**
 * Einmaliger Nachzug: räumt Auto-Deals auf, die an bereits als info/spam
 * klassifizierten Konversationen hängen (entstanden, bevor der WhatsApp-Ingest
 * das Noise-Gate hatte). Nutzt cleanupNoiseDeal — gelöscht wird nur ein
 * nachweislich unberührter Deal (Stage noch "Neue Anfrage", keine Angebote,
 * keine weiteren Konversationen), soft-delete via records.deleted_at.
 *
 * DRY-RUN by default — --apply mutiert.
 * Run: pnpm --filter @openclaw-crm/web exec tsx scripts/cleanup-noise-deals.ts
 */
import "./_load-env";
import { db } from "@/db";
import { inboxConversations, inboxContacts } from "@/db/schema/inbox";
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { cleanupNoiseDeal } from "@/services/inbox";

const APPLY = process.argv.includes("--apply");

async function main() {
  console.log(`Noise-Deal-Cleanup — ${APPLY ? "APPLY" : "DRY-RUN"}\n`);

  const candidates = await db
    .select({
      id: inboxConversations.id,
      workspaceId: inboxConversations.workspaceId,
      lane: inboxConversations.lane,
      preview: inboxConversations.lastMessagePreview,
      contactName: inboxContacts.displayName,
    })
    .from(inboxConversations)
    .innerJoin(inboxContacts, eq(inboxConversations.contactId, inboxContacts.id))
    .where(
      and(
        inArray(inboxConversations.lane, ["info", "spam"]),
        isNotNull(inboxConversations.dealRecordId)
      )
    );
  console.log(`Kandidaten (info/spam mit Deal): ${candidates.length}`);

  let deleted = 0;
  for (const c of candidates) {
    const res = await cleanupNoiseDeal({
      workspaceId: c.workspaceId,
      conversationId: c.id,
      dryRun: !APPLY,
    });
    if (res.action === "deleted" || res.action === "would-delete") deleted++;
    console.log(
      `  [${res.action}] ${c.contactName ?? c.id} (${c.lane}): "${(c.preview ?? "").slice(0, 50)}" — ${res.reason}`
    );
  }
  console.log(
    `\n${APPLY ? `Soft-gelöscht: ${deleted}` : `Würde löschen: ${deleted}`}${APPLY ? "" : " — mit --apply ausführen."}`
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("cleanup-noise-deals failed:", err);
    process.exit(1);
  });
