import "dotenv/config";
import postgres from "postgres";
import { normalizeDatabaseUrl } from "./normalize-database-url";

/**
 * One-shot migration: employee portal foundation.
 *
 *  - users: + role, username, display_username (better-auth username plugin)
 *  - employees: + user_id (link to login account)
 *  - expenses: + receipt_job_media_id (Blob-backed receipt photo)
 *  - new enums + tables: employee_time_entries, job_media
 *
 * Fully idempotent (IF NOT EXISTS guards). No existing rows are modified.
 */
async function main() {
  const connectionString = normalizeDatabaseUrl(process.env.DATABASE_URL);
  if (!connectionString) throw new Error("DATABASE_URL is required");
  const sql = postgres(connectionString, { ssl: "require" });

  console.log("users: role / username / display_username …");
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'staff'`;
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS username text`;
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS display_username text`;
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS users_username_unique ON users (username)`;

  console.log("employees: user_id …");
  await sql`ALTER TABLE employees ADD COLUMN IF NOT EXISTS user_id text`;
  await sql`
    DO $$ BEGIN
      ALTER TABLE employees ADD CONSTRAINT employees_user_id_users_id_fk
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;
    EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  `;
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS employees_user_id_unique ON employees (user_id)`;
  await sql`CREATE INDEX IF NOT EXISTS employees_user_idx ON employees (user_id)`;

  console.log("expenses: receipt_job_media_id …");
  await sql`ALTER TABLE expenses ADD COLUMN IF NOT EXISTS receipt_job_media_id text`;

  console.log("enums …");
  await sql`DO $$ BEGIN CREATE TYPE employee_time_entry_status AS ENUM ('open','submitted','approved'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;`;
  await sql`DO $$ BEGIN CREATE TYPE job_media_category AS ENUM ('stairwell','loading','overview','damage','truck_loaded','final_loaded','receipt','other'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;`;

  console.log("table employee_time_entries …");
  await sql`
    CREATE TABLE IF NOT EXISTS employee_time_entries (
      id text PRIMARY KEY,
      workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      deal_record_id text REFERENCES records(id) ON DELETE SET NULL,
      employee_id text NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
      date date NOT NULL,
      start_at timestamp NOT NULL,
      end_at timestamp,
      break_minutes integer NOT NULL DEFAULT 0,
      status employee_time_entry_status NOT NULL DEFAULT 'open',
      notes text,
      ledger_entry_id text,
      approved_by_user_id text REFERENCES users(id) ON DELETE SET NULL,
      approved_at timestamp,
      created_at timestamp NOT NULL DEFAULT now(),
      updated_at timestamp NOT NULL DEFAULT now()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS ete_workspace_idx ON employee_time_entries (workspace_id)`;
  await sql`CREATE INDEX IF NOT EXISTS ete_deal_idx ON employee_time_entries (deal_record_id)`;
  await sql`CREATE INDEX IF NOT EXISTS ete_employee_idx ON employee_time_entries (employee_id)`;
  await sql`CREATE INDEX IF NOT EXISTS ete_status_idx ON employee_time_entries (status)`;

  console.log("table job_media …");
  await sql`
    CREATE TABLE IF NOT EXISTS job_media (
      id text PRIMARY KEY,
      workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      deal_record_id text REFERENCES records(id) ON DELETE SET NULL,
      employee_id text REFERENCES employees(id) ON DELETE SET NULL,
      uploaded_by_user_id text REFERENCES users(id) ON DELETE SET NULL,
      category job_media_category NOT NULL DEFAULT 'other',
      blob_pathname text NOT NULL,
      blob_url text NOT NULL,
      content_type text NOT NULL,
      size_bytes integer NOT NULL DEFAULT 0,
      etag text,
      caption text,
      captured_at timestamp,
      created_at timestamp NOT NULL DEFAULT now()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS job_media_workspace_idx ON job_media (workspace_id)`;
  await sql`CREATE INDEX IF NOT EXISTS job_media_deal_idx ON job_media (deal_record_id)`;
  await sql`CREATE INDEX IF NOT EXISTS job_media_employee_idx ON job_media (employee_id)`;
  await sql`CREATE INDEX IF NOT EXISTS job_media_category_idx ON job_media (category)`;

  console.log("✓ Done.");
  await sql.end();
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
