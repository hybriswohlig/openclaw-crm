/**
 * One-off migration: add summary + show_standard_inclusions columns to the
 * quotations table. Pure-additive, defaults set, no data loss possible.
 *
 * Run from the repo root or apps/web with:
 *   pnpm exec tsx apps/web/scripts/apply-quotation-columns.mjs
 *
 * Safe to re-run — both ALTER TABLE statements use IF NOT EXISTS.
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

console.log("Adding quotations.summary …");
await sql.unsafe(`ALTER TABLE quotations ADD COLUMN IF NOT EXISTS summary text;`);

console.log("Adding quotations.show_standard_inclusions …");
await sql.unsafe(
  `ALTER TABLE quotations ADD COLUMN IF NOT EXISTS show_standard_inclusions boolean NOT NULL DEFAULT true;`
);

const cols = await sql`
  SELECT column_name, data_type, column_default, is_nullable
  FROM information_schema.columns
  WHERE table_name = 'quotations'
    AND column_name IN ('summary', 'show_standard_inclusions')
  ORDER BY column_name
`;
console.log("\nResult:");
for (const c of cols) {
  console.log(`  ${c.column_name.padEnd(28)} ${c.data_type.padEnd(10)} nullable=${c.is_nullable} default=${c.column_default ?? "—"}`);
}

await sql.end();
console.log("\nDone.");
