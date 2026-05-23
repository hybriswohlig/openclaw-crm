/**
 * Un-revokes one or all customer status links.
 *
 *   pnpm exec tsx scripts/reactivate-customer-link.mjs           # lists revoked links
 *   pnpm exec tsx scripts/reactivate-customer-link.mjs --all     # un-revokes all
 *   pnpm exec tsx scripts/reactivate-customer-link.mjs <token>   # un-revokes one
 *
 * Idempotent. Only touches revoked rows.
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
const sql = postgres(url, { ssl: "require" });

const arg = process.argv[2];

if (!arg) {
  const rows = await sql`
    SELECT token, deal_record_id, revoked_at
    FROM customer_status_links
    WHERE revoked_at IS NOT NULL
    ORDER BY revoked_at DESC
  `;
  console.log(`Found ${rows.length} revoked link(s):\n`);
  for (const r of rows) {
    console.log(`  token=${r.token}  deal=${r.deal_record_id.slice(0, 8)}  revoked_at=${r.revoked_at.toISOString()}`);
  }
  console.log("\nRun with --all to un-revoke all, or with the token to un-revoke one.");
} else if (arg === "--all") {
  const r = await sql`
    UPDATE customer_status_links SET revoked_at = NULL WHERE revoked_at IS NOT NULL RETURNING token
  `;
  console.log(`Un-revoked ${r.length} link(s):`);
  for (const x of r) console.log(`  ${x.token}`);
} else {
  const r = await sql`
    UPDATE customer_status_links SET revoked_at = NULL
    WHERE token = ${arg} AND revoked_at IS NOT NULL
    RETURNING token
  `;
  if (r.length === 0) console.log("No matching revoked link.");
  else console.log(`Un-revoked: ${r[0].token}`);
}

await sql.end();
