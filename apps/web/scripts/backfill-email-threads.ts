/**
 * Einmalig: auseinandergerissene E-Mail-Threads zusammenlegen und fehlende
 * Deals für direkte Kundenmails (Kontaktart Lead/Kunde, Lane Lead) anlegen.
 *
 * Trockenlauf ist der Default. Es wird nichts geschrieben und keine Mail
 * verschickt. Mit --apply werden Konversationen zusammengelegt und Deals
 * angelegt. Der Lauf holt keine Mails aus Gmail; das macht der nächste Sync.
 *
 *   pnpm --filter @openclaw-crm/web exec tsx scripts/backfill-email-threads.ts
 *   pnpm --filter @openclaw-crm/web exec tsx scripts/backfill-email-threads.ts --apply
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";

const here = path.dirname(fileURLToPath(import.meta.url));
const webDir = path.resolve(here, "..");
const repoRoot = path.resolve(webDir, "../..");
for (const envPath of [
  path.join(repoRoot, ".env.local"),
  path.join(repoRoot, ".env"),
  path.join(webDir, ".env.local"),
  path.join(webDir, ".env"),
]) loadEnv({ path: envPath, override: false, quiet: true });

import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  channelAccounts,
  inboxConversations,
  inboxMessageAttachments,
  inboxMessages,
} from "@/db/schema/inbox";
import { isLeadKunde } from "@/lib/kontaktart";
import {
  EMAIL_THREAD_WINDOW_MS,
  headerIdList,
  normalizeEmailSubject,
  normalizeMessageId,
} from "@/services/inbox-email-intake";
import { ensureEmailLeadDeal } from "@/services/inbox-email-lead-deal";

const apply = process.argv.includes("--apply");

interface ConvRow {
  id: string;
  workspaceId: string;
  channelAccountId: string;
  contactId: string;
  externalThreadId: string | null;
  subject: string | null;
  status: string;
  lane: string;
  kontaktart: string;
  dealRecordId: string | null;
  lastMessageAt: Date | null;
  createdAt: Date;
}

function timeOf(value: Date | string | null | undefined): number {
  if (!value) return 0;
  const ms = (value instanceof Date ? value : new Date(value)).getTime();
  return Number.isNaN(ms) ? 0 : ms;
}

function headerIds(raw: string | null): string[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!parsed || typeof parsed !== "object") return [];
  const ids: string[] = [];
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    const name = key.toLowerCase();
    if (name === "in-reply-to" || name === "references" || name === "message-id") {
      ids.push(...headerIdList(value));
    }
  }
  return ids;
}

class UnionFind {
  private parent = new Map<string, string>();

  add(id: string) {
    if (!this.parent.has(id)) this.parent.set(id, id);
  }

  find(id: string): string {
    const current = this.parent.get(id) ?? id;
    if (current === id) return id;
    const root = this.find(current);
    this.parent.set(id, root);
    return root;
  }

  union(a: string, b: string) {
    const left = this.find(a);
    const right = this.find(b);
    if (left !== right) this.parent.set(left, right);
  }

  groups(): Map<string, string[]> {
    const out = new Map<string, string[]>();
    for (const id of this.parent.keys()) {
      const root = this.find(id);
      const list = out.get(root) ?? [];
      list.push(id);
      out.set(root, list);
    }
    return out;
  }
}

function pickSurvivor(ids: string[], byId: Map<string, ConvRow>): string {
  const rows = ids.map((id) => byId.get(id)).filter((row): row is ConvRow => !!row);
  const withDeal = rows.filter((row) => row.dealRecordId);
  const pool = withDeal.length > 0 ? withDeal : rows;
  pool.sort((a, b) => {
    if (withDeal.length > 0) return timeOf(b.lastMessageAt) - timeOf(a.lastMessageAt);
    return timeOf(a.createdAt) - timeOf(b.createdAt);
  });
  return pool[0]!.id;
}

async function loadInChunks<T>(ids: string[], load: (slice: string[]) => Promise<T[]>): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += 400) {
    out.push(...(await load(ids.slice(i, i + 400))));
  }
  return out;
}

async function main() {
  const accounts = await db
    .select({ id: channelAccounts.id, address: channelAccounts.address })
    .from(channelAccounts)
    .where(eq(channelAccounts.channelType, "email"));
  if (accounts.length === 0) {
    console.log("Keine E-Mail-Konten. Nichts zu tun.");
    return;
  }

  const conversations = await loadInChunks(accounts.map((account) => account.id), (slice) =>
    db
      .select({
        id: inboxConversations.id,
        workspaceId: inboxConversations.workspaceId,
        channelAccountId: inboxConversations.channelAccountId,
        contactId: inboxConversations.contactId,
        externalThreadId: inboxConversations.externalThreadId,
        subject: inboxConversations.subject,
        status: inboxConversations.status,
        lane: inboxConversations.lane,
        kontaktart: inboxConversations.kontaktart,
        dealRecordId: inboxConversations.dealRecordId,
        lastMessageAt: inboxConversations.lastMessageAt,
        createdAt: inboxConversations.createdAt,
      })
      .from(inboxConversations)
      .where(inArray(inboxConversations.channelAccountId, slice))
  );
  const byId = new Map(conversations.map((row) => [row.id, row]));
  const messages = await loadInChunks([...byId.keys()], (slice) =>
    db
      .select({
        id: inboxMessages.id,
        conversationId: inboxMessages.conversationId,
        externalMessageId: inboxMessages.externalMessageId,
        rawHeaders: inboxMessages.rawHeaders,
        sentAt: inboxMessages.sentAt,
      })
      .from(inboxMessages)
      .where(inArray(inboxMessages.conversationId, slice))
  );

  const uf = new UnionFind();
  for (const row of conversations) uf.add(row.id);
  const owners = new Map<string, string[]>();
  const note = (channelId: string, value: string | null | undefined, conversationId: string) => {
    const norm = normalizeMessageId(value);
    if (!norm) return;
    const key = `${channelId}\0${norm}`;
    const list = owners.get(key) ?? [];
    if (!list.includes(conversationId)) list.push(conversationId);
    owners.set(key, list);
  };
  for (const row of conversations) note(row.channelAccountId, row.externalThreadId, row.id);
  for (const message of messages) {
    const conv = byId.get(message.conversationId);
    if (!conv) continue;
    note(conv.channelAccountId, message.externalMessageId, conv.id);
    for (const id of headerIds(message.rawHeaders)) note(conv.channelAccountId, id, conv.id);
  }
  for (const list of owners.values()) {
    for (const id of list.slice(1)) uf.union(list[0]!, id);
  }

  const subjectBuckets = new Map<string, ConvRow[]>();
  for (const row of conversations) {
    if (row.status !== "open") continue;
    const subject = normalizeEmailSubject(row.subject);
    if (!subject) continue;
    const key = `${row.channelAccountId}\0${row.contactId}\0${subject}`;
    const list = subjectBuckets.get(key) ?? [];
    list.push(row);
    subjectBuckets.set(key, list);
  }
  for (const list of subjectBuckets.values()) {
    const sorted = [...list].sort((a, b) => timeOf(a.lastMessageAt) - timeOf(b.lastMessageAt));
    for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 1; j < sorted.length; j++) {
        if (Math.abs(timeOf(sorted[i]!.lastMessageAt) - timeOf(sorted[j]!.lastMessageAt)) <= EMAIL_THREAD_WINDOW_MS) {
          uf.union(sorted[i]!.id, sorted[j]!.id);
        }
      }
    }
  }

  const merges = [...uf.groups().values()].filter((ids) => ids.length > 1);
  console.log(
    `${apply ? "Anwenden" : "Trockenlauf"}: ${conversations.length} E-Mail-Konversationen, ${merges.length} Threads zum Zusammenlegen.`
  );

  const removed = new Set<string>();
  for (const ids of merges) {
    const survivorId = pickSurvivor(ids, byId);
    const donors = ids.filter((id) => id !== survivorId);
    const survivor = byId.get(survivorId)!;
    const donorDeals: ConvRow[] = [];
    for (const id of donors) {
      const row = byId.get(id);
      if (row?.dealRecordId) donorDeals.push(row);
    }
    donorDeals.sort((a, b) => {
      if (a.status === "open" && b.status !== "open") return -1;
      if (b.status === "open" && a.status !== "open") return 1;
      return timeOf(b.lastMessageAt) - timeOf(a.lastMessageAt);
    });
    const donorDeal = donorDeals[0];
    console.log(
      `  ${survivorId} bleibt, ${donors.join(", ")} geht darin auf` +
        (!survivor.dealRecordId && donorDeal?.dealRecordId ? `, Deal ${donorDeal.dealRecordId}` : "")
    );
    if (!apply) {
      for (const id of donors) removed.add(id);
      if (!survivor.dealRecordId && donorDeal?.dealRecordId) survivor.dealRecordId = donorDeal.dealRecordId;
      continue;
    }

    if (!survivor.dealRecordId && donorDeal?.dealRecordId) {
      await db
        .update(inboxConversations)
        .set({ dealRecordId: donorDeal.dealRecordId, updatedAt: new Date() })
        .where(and(eq(inboxConversations.id, survivorId), eq(inboxConversations.workspaceId, survivor.workspaceId)));
      survivor.dealRecordId = donorDeal.dealRecordId;
    }

    const survivorIds = new Set(
      messages
        .filter((message) => message.conversationId === survivorId)
        .map((message) => normalizeMessageId(message.externalMessageId))
        .filter((id): id is string => !!id)
    );
    let latest = timeOf(survivor.lastMessageAt);
    for (const donorId of donors) {
      const donorMessages = messages.filter((message) => message.conversationId === donorId);
      for (const message of donorMessages) {
        const norm = normalizeMessageId(message.externalMessageId);
        if (norm && survivorIds.has(norm)) {
          await db.delete(inboxMessages).where(eq(inboxMessages.id, message.id));
          continue;
        }
        if (norm) survivorIds.add(norm);
        await db.update(inboxMessages).set({ conversationId: survivorId }).where(eq(inboxMessages.id, message.id));
        await db
          .update(inboxMessageAttachments)
          .set({
            conversationId: survivorId,
            ...(survivor.dealRecordId ? { dealRecordId: survivor.dealRecordId } : {}),
          })
          .where(eq(inboxMessageAttachments.messageId, message.id));
        latest = Math.max(latest, timeOf(message.sentAt));
      }
      const [left] = await db
        .select({ id: inboxMessages.id })
        .from(inboxMessages)
        .where(eq(inboxMessages.conversationId, donorId))
        .limit(1);
      if (!left) {
        await db.delete(inboxConversations).where(eq(inboxConversations.id, donorId));
        removed.add(donorId);
      }
    }
    if (latest > timeOf(survivor.lastMessageAt)) {
      await db
        .update(inboxConversations)
        .set({ lastMessageAt: new Date(latest), updatedAt: new Date() })
        .where(eq(inboxConversations.id, survivorId));
    }
  }

  const missingDeals = conversations.filter(
    (row) =>
      !removed.has(row.id) &&
      row.lane === "lead" &&
      isLeadKunde(row.kontaktart) &&
      !row.dealRecordId
  );
  console.log(`${missingDeals.length} Lead-Konversationen ohne Deal.`);
  for (const row of missingDeals) {
    console.log(`  Deal für ${row.id} (${row.subject ?? "ohne Betreff"})`);
    if (!apply) continue;
    const dealId = await ensureEmailLeadDeal(row.id);
    console.log(dealId ? `    angelegt/verknüpft: ${dealId}` : "    kein Deal (kein Lead oder kein E-Mail-Kanal)");
  }

  if (!apply) {
    console.log("Trockenlauf beendet. Zum Schreiben dieselbe Datei mit --apply aufrufen. Es wird dabei keine Kundenmail gesendet.");
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
