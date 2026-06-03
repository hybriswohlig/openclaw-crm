/**
 * One-off migration 0032: add email_provider + last_sync_history_id +
 * watch_expires_at to channel_accounts so Google Workspace mailboxes can run
 * through the Gmail REST API alongside the existing IMAP/SMTP rows.
 *
 * Pure-additive, defaults set, no data loss possible. Safe to re-run — every
 * ALTER TABLE uses IF NOT EXISTS.
 *
 * Run from the repo root or apps/web with:
 *   pnpm exec tsx apps/web/scripts/apply-gmail-api-columns.mjs
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import postgres from "postgres";

const here = path.dirname(fileURLToPath(import.meta.url));
const webDir = path.resolve(here, "..");
const repoRoot = path.resolve(webDir, "../..");
for (const p of [
  path.join(repoRoot, ".env.local"),
  path.join(repoRoot, ".env"),
  path.join(webDir, ".env.local"),
  path.join(webDir, ".env"),
]) loadEnv({ path: p, override: false, quiet: true });

const url = (process.env.DATABASE_URL || "").replace(/&channel_binding=require/, "");
if (!url) {
  console.error("DATABASE_URL missing — check apps/web/.env.local");
  process.exit(1);
}

const sql = postgres(url, { ssl: "require" });

console.log("Adding channel_accounts.email_provider …");
await sql.unsafe(
  `ALTER TABLE channel_accounts ADD COLUMN IF NOT EXISTS email_provider text DEFAULT 'imap_smtp';`
);

console.log("Adding channel_accounts.last_sync_history_id …");
await sql.unsafe(
  `ALTER TABLE channel_accounts ADD COLUMN IF NOT EXISTS last_sync_history_id text;`
);

console.log("Adding channel_accounts.watch_expires_at …");
await sql.unsafe(
  `ALTER TABLE channel_accounts ADD COLUMN IF NOT EXISTS watch_expires_at timestamp;`
);

const cols = await sql`
  SELECT column_name, data_type, column_default, is_nullable
  FROM information_schema.columns
  WHERE table_name = 'channel_accounts'
    AND column_name IN ('email_provider', 'last_sync_history_id', 'watch_expires_at')
  ORDER BY column_name
`;
console.log("\nResult:");
for (const c of cols) {
  console.log(
    `  ${c.column_name.padEnd(22)} ${c.data_type.padEnd(10)} nullable=${c.is_nullable} default=${c.column_default ?? "—"}`
  );
}

await sql.end();
console.log("\nDone.");
