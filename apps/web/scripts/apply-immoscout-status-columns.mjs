/**
 * One-off migration: add last_sync_at + last_sync_result to integrations so the
 * ImmoScout lead-import cron can persist + display its last run (time, counts,
 * errors) on the integrations page.
 *
 * Pure-additive, nullable, no data loss. Safe to re-run — ALTER uses IF NOT EXISTS.
 *
 * Run from the repo root or apps/web with:
 *   pnpm exec tsx apps/web/scripts/apply-immoscout-status-columns.mjs
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
  console.error("DATABASE_URL missing — check .env.local");
  process.exit(1);
}

const sql = postgres(url, { ssl: "require" });

console.log("Adding integrations.last_sync_at …");
await sql.unsafe(
  `ALTER TABLE integrations ADD COLUMN IF NOT EXISTS last_sync_at timestamp;`
);

console.log("Adding integrations.last_sync_result …");
await sql.unsafe(
  `ALTER TABLE integrations ADD COLUMN IF NOT EXISTS last_sync_result text;`
);

const cols = await sql`
  SELECT column_name, data_type, is_nullable
  FROM information_schema.columns
  WHERE table_name = 'integrations'
    AND column_name IN ('last_sync_at', 'last_sync_result')
  ORDER BY column_name
`;
console.log("\nResult:");
for (const c of cols) {
  console.log(`  ${c.column_name.padEnd(18)} ${c.data_type.padEnd(26)} nullable=${c.is_nullable}`);
}

await sql.end();
console.log("\nDone.");
