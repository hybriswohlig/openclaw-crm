/**
 * One-time (and re-runnable) email import script.
 *
 * Usage:
 *   pnpm --filter @openclaw-crm/web tsx scripts/import-emails.ts
 *   pnpm --filter @openclaw-crm/web tsx scripts/import-emails.ts --reset   # re-fetch all, ignore sync UID
 *
 * Reads EMAIL_N_ADDRESS / EMAIL_N_PASSWORD from .env.local at the repo root.
 * Safe to run multiple times — deduplicates by Message-ID.
 */

import "dotenv/config"; // picks up .env.local via dotenv default search
import path from "path";
import { config } from "dotenv";
import { ImapFlow } from "imapflow";
import { simpleParser, type ParsedMail, type AddressObject } from "mailparser";
import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import { eq, and, sql as drizzleSql } from "drizzle-orm";
import * as schema from "../src/db/schema/index";

// Load root .env.local (repo root, two levels up from apps/web)
config({ path: path.resolve(__dirname, "../../../.env.local") });
config({ path: path.resolve(__dirname, "../.env.local"), override: false });

const RESET = process.argv.includes("--reset");

// ─── DB setup ─────────────────────────────────────────────────────────────────

const dbUrl = process.env.DATABASE_URL;
if (!dbUrl) throw new Error("DATABASE_URL is not set");

const sql = neon(dbUrl);
const db = drizzle(sql, { schema });

const {
  channelAccounts,
  inboxContacts,
  inboxConversations,
  inboxMessages,
  workspaces,
} = schema;

// ─── Email account config ─────────────────────────────────────────────────────

interface EmailConfig { address: string; password: string }

function getEmailConfigs(): EmailConfig[] {
  const configs: EmailConfig[] = [];
  let i = 1;
  while (true) {
    const address = process.env[`EMAIL_${i}_ADDRESS`];
    const password = process.env[`EMAIL_${i}_PASSWORD`];
    if (!address || !password) break;
    configs.push({ address, password });
    i++;
  }
  return configs;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const KLEINANZEIGEN_RELAY_RE = /^[a-z0-9]+-[a-f0-9]{40,}-ek-ek@mail\.kleinanzeigen\.de$/i;
const KLEINANZEIGEN_SUBJECT_RE = /nutzer-anfrage|anfrage zu deiner anzeige/i;

function isKleinanzeigen(from: string, subject: string) {
  return KLEINANZEIGEN_RELAY_RE.test(from) || KLEINANZEIGEN_SUBJECT_RE.test(subject);
}

function firstAddr(ao: AddressObject | AddressObject[] | undefined) {
  const list = Array.isArray(ao) ? ao : ao ? [ao] : [];
  const val = list[0]?.value?.[0];
  return { name: val?.name ?? "", address: val?.address ?? "" };
}

function parseKleinanzeigenBody(text: string): string {
  const m =
    text.match(/nachricht[:\s]+([\s\S]+?)(?:\n{2,}|--)/i) ??
    text.match(/anfrage[:\s]+([\s\S]+?)(?:\n{2,}|--)/i);
  return m ? m[1].trim() : text.trim();
}

// ─── Upsert helpers ───────────────────────────────────────────────────────────

async function getOrCreateWorkspaceId(): Promise<string> {
  const [ws] = await db.select({ id: workspaces.id }).from(workspaces).limit(1);
  if (!ws) throw new Error("No workspace found in DB — run the app once first to seed it.");
  return ws.id;
}

async function upsertChannelAccount(workspaceId: string, cfg: EmailConfig) {
  const existing = await db
    .select()
    .from(channelAccounts)
    .where(
      and(
        eq(channelAccounts.workspaceId, workspaceId),
        eq(channelAccounts.address, cfg.address)
      )
    )
    .limit(1);

  if (existing[0]) {
    // Keep credential in sync
    await db
      .update(channelAccounts)
      .set({ credential: cfg.password, updatedAt: new Date() })
      .where(eq(channelAccounts.id, existing[0].id));
    return existing[0];
  }

  const [created] = await db
    .insert(channelAccounts)
    .values({
      workspaceId,
      channelType: "email",
      name: cfg.address,
      address: cfg.address,
      credential: cfg.password,
      imapHost: process.env.IMAP_SERVER ?? "imap.gmail.com",
      smtpHost: process.env.SMTP_SERVER ?? "smtp.gmail.com",
      isActive: true,
      lastSyncUid: 0,
    })
    .returning();
  return created;
}

async function upsertContact(workspaceId: string, email: string, displayName: string) {
  const [existing] = await db
    .select()
    .from(inboxContacts)
    .where(
      and(eq(inboxContacts.workspaceId, workspaceId), eq(inboxContacts.email, email))
    )
    .limit(1);

  if (existing) return existing;

  const [created] = await db
    .insert(inboxContacts)
    .values({ workspaceId, email, displayName: displayName || email })
    .returning();
  return created;
}

// ─── Main import logic ────────────────────────────────────────────────────────

async function importAccount(workspaceId: string, account: Awaited<ReturnType<typeof upsertChannelAccount>>, cfg: EmailConfig) {
  const log = (msg: string) => console.log(`  [${cfg.address}] ${msg}`);

  if (RESET) {
    await db
      .update(channelAccounts)
      .set({ lastSyncUid: 0, updatedAt: new Date() })
      .where(eq(channelAccounts.id, account.id));
    account.lastSyncUid = 0;
    log("Reset lastSyncUid → fetching all messages");
  }

  const client = new ImapFlow({
    host: account.imapHost ?? "imap.gmail.com",
    port: 993,
    secure: true,
    auth: { user: cfg.address, pass: cfg.password },
    logger: false,
  });

  await client.connect();
  const lock = await client.getMailboxLock("INBOX");

  let fetched = 0, stored = 0, skipped = 0;
  let maxUid = account.lastSyncUid ?? 0;

  try {
    const lastUid = account.lastSyncUid ?? 0;
    const range = lastUid > 0 ? `${lastUid + 1}:*` : "1:*";
    log(`Fetching UID range ${range} …`);

    for await (const msg of client.fetch(range, { uid: true, envelope: true, source: true })) {
      const uid = msg.uid;
      if (uid <= lastUid) continue;
      if (uid > maxUid) maxUid = uid;
      fetched++;

      if (!msg.source) { skipped++; continue; }

      let parsed: ParsedMail;
      try {
        parsed = await simpleParser(msg.source as Buffer);
      } catch {
        log(`  UID ${uid}: parse error, skipping`);
        skipped++;
        continue;
      }

      const fromObj = firstAddr(parsed.from);
      const fromEmail = fromObj.address.toLowerCase();
      const fromName = fromObj.name;
      const subject = parsed.subject ?? "";
      const messageId = parsed.messageId ?? `uid-${uid}@${cfg.address}`;

      // Skip our own sent messages stored in INBOX (e.g. BCC copies)
      if (fromEmail === cfg.address.toLowerCase()) { skipped++; continue; }

      // Dedup
      const [dup] = await db
        .select({ id: inboxMessages.id })
        .from(inboxMessages)
        .where(eq(inboxMessages.externalMessageId, messageId))
        .limit(1);
      if (dup) { skipped++; continue; }

      const isKlein = isKleinanzeigen(fromEmail, subject);
      const threadKey = isKlein ? fromEmail : (parsed.inReplyTo ?? messageId);

      let body = parsed.text ?? "";
      if (isKlein) body = parseKleinanzeigenBody(body);
      const preview = body.slice(0, 120).replace(/\s+/g, " ");
      const sentAt = parsed.date ?? new Date();

      const contact = await upsertContact(workspaceId, fromEmail, fromName);

      // Upsert conversation
      const [existingConv] = await db
        .select()
        .from(inboxConversations)
        .where(
          and(
            eq(inboxConversations.channelAccountId, account.id),
            eq(inboxConversations.externalThreadId, threadKey)
          )
        )
        .limit(1);

      let convId: string;
      if (existingConv) {
        await db
          .update(inboxConversations)
          .set({
            lastMessageAt: sentAt > (existingConv.lastMessageAt ?? new Date(0)) ? sentAt : existingConv.lastMessageAt,
            lastMessagePreview: preview,
            unreadCount: (existingConv.unreadCount ?? 0) + 1,
            updatedAt: new Date(),
          })
          .where(eq(inboxConversations.id, existingConv.id));
        convId = existingConv.id;
      } else {
        const [conv] = await db
          .insert(inboxConversations)
          .values({
            workspaceId,
            channelAccountId: account.id,
            contactId: contact.id,
            externalThreadId: threadKey,
            subject,
            lastMessageAt: sentAt,
            lastMessagePreview: preview,
            unreadCount: 1,
          })
          .returning();
        convId = conv.id;
      }

      await db.insert(inboxMessages).values({
        workspaceId,
        conversationId: convId,
        direction: "inbound",
        status: "received",
        externalMessageId: messageId,
        fromAddress: fromEmail,
        toAddress: cfg.address,
        subject,
        body,
        bodyHtml: typeof parsed.html === "string" ? parsed.html : null,
        isRead: false,
        sentAt,
      });

      stored++;
      process.stdout.write(`\r  [${cfg.address}] ${fetched} fetched, ${stored} stored, ${skipped} skipped`);
    }

    console.log(); // newline after progress

    if (maxUid > (account.lastSyncUid ?? 0)) {
      await db
        .update(channelAccounts)
        .set({ lastSyncUid: maxUid, lastSyncAt: new Date(), updatedAt: new Date() })
        .where(eq(channelAccounts.id, account.id));
    }

    log(`Done. ${stored} new messages imported, ${skipped} skipped. Max UID: ${maxUid}`);
  } finally {
    lock.release();
    await client.logout();
  }
}

// ─── Entry point ──────────────────────────────────────────────────────────────

async function main() {
  const configs = getEmailConfigs();
  if (configs.length === 0) {
    throw new Error("No email accounts configured. Set EMAIL_1_ADDRESS and EMAIL_1_PASSWORD in .env.local");
  }

  console.log(`\n📬 Email import — ${configs.length} account(s)${RESET ? " [RESET mode]" : ""}\n`);

  const workspaceId = await getOrCreateWorkspaceId();
  console.log(`Workspace: ${workspaceId}\n`);

  for (const cfg of configs) {
    console.log(`▶ ${cfg.address}`);
    const account = await upsertChannelAccount(workspaceId, cfg);
    await importAccount(workspaceId, account, cfg);
    console.log();
  }

  // Summary
  const [{ convCount }] = await db
    .select({ convCount: drizzleSql<number>`COUNT(*)` })
    .from(inboxConversations);
  const [{ msgCount }] = await db
    .select({ msgCount: drizzleSql<number>`COUNT(*)` })
    .from(inboxMessages);

  console.log(`✅ Import complete.`);
  console.log(`   Total conversations: ${convCount}`);
  console.log(`   Total messages:      ${msgCount}`);
}

main().catch((err) => {
  console.error("\n❌ Import failed:", err.message ?? err);
  process.exit(1);
});
