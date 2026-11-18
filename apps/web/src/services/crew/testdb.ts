/**
 * Nur für Tests: Wegwerf-Schema in EINSATZ_TEST_DATABASE_URL mit den Spalten,
 * die Crew-Dienste, Einsatz-Termin und Fotos lesen, plus die echten Migrationen
 * 0066 bis 0069. Die Tests binden `@/db` per `search_path` an dieses Schema.
 */
import { readFileSync } from "node:fs";
import type postgres from "postgres";

export async function crewTestSchemaAnlegen(sql: postgres.Sql, schema: string): Promise<void> {
  await sql.unsafe(`CREATE SCHEMA ${schema}`);
  await sql.unsafe(`SET search_path TO ${schema}`);
  await sql.unsafe(`
    CREATE TABLE workspaces (id text PRIMARY KEY);
    CREATE TABLE objects (id text PRIMARY KEY, workspace_id text NOT NULL REFERENCES workspaces(id), slug text NOT NULL);
    CREATE TABLE attributes (id text PRIMARY KEY, object_id text NOT NULL REFERENCES objects(id), slug text NOT NULL);
    CREATE TABLE records (id text PRIMARY KEY, object_id text NOT NULL REFERENCES objects(id),
      created_at timestamp NOT NULL DEFAULT now(), deleted_at timestamp);
    CREATE TABLE record_values (id text PRIMARY KEY DEFAULT gen_random_uuid()::text, record_id text NOT NULL REFERENCES records(id) ON DELETE CASCADE,
      attribute_id text NOT NULL REFERENCES attributes(id), text_value text, number_value numeric, date_value date,
      timestamp_value timestamp, boolean_value boolean, json_value jsonb, referenced_record_id text, sort_order integer NOT NULL DEFAULT 0);
    CREATE TABLE statuses (id text PRIMARY KEY, attribute_id text NOT NULL, stage_category text);
    CREATE TABLE select_options (id text PRIMARY KEY, attribute_id text NOT NULL, title text NOT NULL);
    CREATE TABLE customer_date_selections (id text PRIMARY KEY DEFAULT gen_random_uuid()::text, workspace_id text NOT NULL,
      deal_record_id text NOT NULL UNIQUE, selected_date date NOT NULL, selected_at timestamp NOT NULL DEFAULT now());
    CREATE TABLE quotations (id text PRIMARY KEY DEFAULT gen_random_uuid()::text, deal_record_id text NOT NULL, service_type text,
      created_at timestamp NOT NULL DEFAULT now());
    CREATE TABLE deal_calculation_versions (id text PRIMARY KEY DEFAULT gen_random_uuid()::text, workspace_id text NOT NULL,
      deal_record_id text NOT NULL, status text NOT NULL, version integer NOT NULL, rechner_request jsonb, rechner_result jsonb);
    CREATE TABLE employees (id text PRIMARY KEY, workspace_id text NOT NULL REFERENCES workspaces(id), name text NOT NULL,
      active boolean NOT NULL DEFAULT true, can_drive_sprinter boolean NOT NULL DEFAULT false,
      rate_work_cents integer NOT NULL DEFAULT 2000, rate_drive_cents integer NOT NULL DEFAULT 1500,
      updated_at timestamp NOT NULL DEFAULT now());
    CREATE TABLE deal_employees (id text PRIMARY KEY DEFAULT gen_random_uuid()::text, deal_record_id text NOT NULL REFERENCES records(id),
      employee_id text NOT NULL REFERENCES employees(id), role text NOT NULL DEFAULT 'helper',
      planned_work_minutes integer, planned_drive_minutes integer, created_at timestamp NOT NULL DEFAULT now());
    CREATE TABLE inbox_message_attachments (id text PRIMARY KEY, workspace_id text NOT NULL, deal_record_id text,
      mime_type text NOT NULL DEFAULT 'image/jpeg', file_content text NOT NULL DEFAULT '', created_at timestamp NOT NULL DEFAULT now());
    CREATE TABLE deal_internal_photos (id text PRIMARY KEY, workspace_id text NOT NULL, deal_record_id text NOT NULL,
      mime_type text NOT NULL DEFAULT 'image/jpeg', file_content text NOT NULL DEFAULT '', created_at timestamp NOT NULL DEFAULT now());
    CREATE TABLE deal_inventory_items (id text PRIMARY KEY DEFAULT gen_random_uuid()::text, workspace_id text NOT NULL, deal_record_id text NOT NULL,
      name text NOT NULL, quantity integer NOT NULL DEFAULT 1, dimensions_estimate text, heavy_flag boolean NOT NULL DEFAULT false,
      fragile_flag boolean NOT NULL DEFAULT false, disassembly_required boolean NOT NULL DEFAULT false, move_flag boolean NOT NULL DEFAULT true,
      notes text, sort_order integer NOT NULL DEFAULT 0, created_at timestamp NOT NULL DEFAULT now());
    CREATE TABLE workspace_settings (workspace_id text NOT NULL, key text NOT NULL, value_plain text, value_encrypted bytea,
      is_secret boolean NOT NULL DEFAULT false, updated_at timestamp NOT NULL DEFAULT now(), PRIMARY KEY (workspace_id, key));
    CREATE TABLE job_media (id text PRIMARY KEY, workspace_id text NOT NULL, deal_record_id text, content_type text NOT NULL,
      blob_pathname text NOT NULL DEFAULT '', size_bytes integer NOT NULL DEFAULT 0, created_at timestamp NOT NULL DEFAULT now());
  `);
  for (const datei of ["0066_crew_portal.sql", "0067_crew_briefing.sql", "0068_crew_briefing_fotos.sql", "0069_crew_ansprechpartner.sql"]) {
    const mig = readFileSync(new URL(`../../db/migrations/${datei}`, import.meta.url), "utf8");
    for (const s of mig.split("--> statement-breakpoint").map((x) => x.trim()).filter(Boolean)) await sql.unsafe(s);
  }
}

/** Wert ins EAV schreiben (Spalte nach Typ des Werts). */
export async function wertSetzen(
  sql: postgres.Sql,
  record: string,
  attribute: string,
  w: { text?: string; zahl?: number; datum?: string; ts?: string; ja?: boolean; json?: unknown; ref?: string },
): Promise<void> {
  await sql`
    INSERT INTO record_values (record_id, attribute_id, text_value, number_value, date_value, timestamp_value, boolean_value, json_value, referenced_record_id)
    VALUES (${record}, ${attribute}, ${w.text ?? null}, ${w.zahl ?? null}, ${w.datum ?? null}, ${w.ts ?? null}, ${w.ja ?? null},
      ${w.json === undefined ? null : sql.json(w.json as never)}, ${w.ref ?? null})`;
}
