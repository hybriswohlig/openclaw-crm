import "dotenv/config";
import postgres from "postgres";
import { normalizeDatabaseUrl } from "./normalize-database-url";

/**
 * calendar_feed_tokens: secret, revocable iCal subscription links.
 * Idempotent. Additive only.
 *
 * Usage: DATABASE_URL=... npx tsx src/db/migrate-2026-10-19-calendar-feeds.ts
 */
async function migrate() {
  const connectionString = normalizeDatabaseUrl(process.env.DATABASE_URL);
  if (!connectionString) throw new Error("DATABASE_URL is required");
  const sql = postgres(connectionString, { max: 1 });

  await sql`CREATE TABLE IF NOT EXISTS calendar_feed_tokens (
      id text PRIMARY KEY,
      workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token text NOT NULL,
      revoked_at timestamp,
      last_used_at timestamp,
      created_at timestamp NOT NULL DEFAULT now()
    )`;
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS calendar_feed_tokens_token_idx
      ON calendar_feed_tokens (token)`;
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS calendar_feed_tokens_active_user_idx
      ON calendar_feed_tokens (workspace_id, user_id)
      WHERE revoked_at IS NULL`;
  await sql`CREATE INDEX IF NOT EXISTS calendar_feed_tokens_workspace_idx
      ON calendar_feed_tokens (workspace_id)`;

  const [{ anzahl }] = await sql`SELECT count(*)::int AS anzahl FROM calendar_feed_tokens`;
  console.log(`calendar_feed_tokens bereit (${anzahl} Zeilen).`);
  await sql.end();
}

migrate().catch((e) => {
  console.error(e);
  process.exit(1);
});
