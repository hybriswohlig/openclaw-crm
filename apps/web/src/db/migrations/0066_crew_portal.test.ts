import { readFileSync } from "node:fs";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const sql = readFileSync(new URL("./0066_crew_portal.sql", import.meta.url), "utf8");
const kompakt = sql.replace(/\s+/g, " ");
const schritte = sql.split("--> statement-breakpoint").map((s) => s.trim()).filter(Boolean);

describe("Migration 0066 Crew-Portal (Text)", () => {
  it("nur additiv und idempotent", () => {
    expect(sql).not.toMatch(/\bDROP\b/i);
    const ohneFk = sql.replace(/ON (DELETE|UPDATE) (CASCADE|SET NULL)/g, "");
    expect(ohneFk).not.toMatch(/\bDELETE\b/i);
    expect(ohneFk).not.toMatch(/\bUPDATE\b/i);
    for (const zeile of sql.split("\n")) {
      if (/^\s*ALTER TABLE .* ADD COLUMN/.test(zeile)) expect(zeile).toContain("ADD COLUMN IF NOT EXISTS");
      if (/^\s*CREATE (UNIQUE )?INDEX/.test(zeile)) expect(zeile).toMatch(/INDEX IF NOT EXISTS/);
      if (/^\s*CREATE TABLE/.test(zeile)) expect(zeile).toContain("CREATE TABLE IF NOT EXISTS");
    }
    for (const c of [
      "employees_locale_check",
      "employees_phone_canonical_format",
      "crew_links_token_format",
      "crew_links_view_count_check",
      "crew_job_responses_answer_check",
      "crew_job_responses_source_check",
    ]) {
      expect(kompakt).toMatch(new RegExp(`WHERE conname = '${c}' AND conrelid = '"[a-z_]+"'::regclass`));
    }
  });

  it("Foto-Freigabe an allen drei Foto-Tabellen", () => {
    for (const t of ["inbox_message_attachments", "deal_internal_photos", "job_media"]) {
      expect(kompakt).toContain(`ALTER TABLE "${t}" ADD COLUMN IF NOT EXISTS "crew_freigegeben_at" timestamptz`);
      expect(kompakt).toContain(`ALTER TABLE "${t}" ADD COLUMN IF NOT EXISTS "crew_freigegeben_by" text`);
    }
  });

  it("steht im Journal als idx 66", () => {
    const journal = JSON.parse(readFileSync(new URL("./meta/_journal.json", import.meta.url), "utf8"));
    expect(journal.entries.find((e: { idx: number }) => e.idx === 66)).toMatchObject({ tag: "0066_crew_portal", when: 1793923200000 });
    const idx = journal.entries.map((e: { idx: number }) => e.idx);
    expect(new Set(idx).size).toBe(idx.length);
  });
});

/**
 * Gegen die Wegwerf-Postgres (EINSATZ_TEST_DATABASE_URL): eigenes Schema mit
 * dem Stand vor 0066 (nur die Spalten, die 0066 braucht), dann zweimal laufen.
 */
const url = process.env.EINSATZ_TEST_DATABASE_URL;

describe.skipIf(!url)("Migration 0066 Crew-Portal (DB)", () => {
  let db: postgres.Sql;
  const schema = `m0066_${Date.now().toString(36)}`;
  const token = "A".repeat(31) + "b";

  const lauf = async () => {
    for (const s of schritte) await db.unsafe(s);
  };

  beforeAll(async () => {
    db = postgres(url!, { max: 1, onnotice: () => {} });
    await db.unsafe(`CREATE SCHEMA ${schema}`);
    await db.unsafe(`SET search_path TO ${schema}`);
    await db.unsafe(`
      CREATE TABLE workspaces (id text PRIMARY KEY);
      CREATE TABLE records (id text PRIMARY KEY);
      CREATE TABLE employees (id text PRIMARY KEY, workspace_id text NOT NULL REFERENCES workspaces(id), name text NOT NULL);
      CREATE TABLE inbox_message_attachments (id text PRIMARY KEY, deal_record_id text);
      CREATE TABLE deal_internal_photos (id text PRIMARY KEY, deal_record_id text NOT NULL);
      CREATE TABLE job_media (id text PRIMARY KEY, deal_record_id text);
      INSERT INTO workspaces VALUES ('w1'), ('w2');
      INSERT INTO records VALUES ('d1'), ('d2');
      INSERT INTO employees VALUES ('e1', 'w1', 'Anna'), ('e2', 'w1', 'Ben'), ('e3', 'w2', 'Cem');
      INSERT INTO inbox_message_attachments VALUES ('a1', 'd1');
    `);
    await lauf();
  });

  afterAll(async () => {
    await db.unsafe(`DROP SCHEMA ${schema} CASCADE`);
    await db.end();
  });

  it("zweiter Lauf ändert nichts und scheitert nicht", async () => {
    await db`UPDATE employees SET locale = 'tr' WHERE id = 'e1'`;
    await lauf();
    expect((await db`SELECT locale FROM employees WHERE id = 'e1'`)[0]!.locale).toBe("tr");
  });

  it("Bestand: Sprache de, kein Telefon, keine Einwilligung; CHECKs greifen", async () => {
    const rows = await db`SELECT id, locale, phone, phone_canonical, photo_consent_at FROM employees WHERE id <> 'e1' ORDER BY id`;
    expect(rows.every((r) => r.locale === "de" && r.phone === null && r.phone_canonical === null && r.photo_consent_at === null)).toBe(true);
    await expect(db`UPDATE employees SET locale = 'fr' WHERE id = 'e2'`).rejects.toThrow(/employees_locale_check/);
    await expect(db`UPDATE employees SET phone_canonical = '015112345678' WHERE id = 'e2'`).rejects.toThrow(/employees_phone_canonical_format/);
  });

  it("Telefon eindeutig je Workspace, nicht über Workspaces", async () => {
    await db`UPDATE employees SET phone = '0151 1234567', phone_canonical = '+491511234567' WHERE id = 'e1'`;
    await expect(db`UPDATE employees SET phone_canonical = '+491511234567' WHERE id = 'e2'`).rejects.toThrow(/employees_phone_canonical_uq/);
    await db`UPDATE employees SET phone_canonical = '+491511234567' WHERE id = 'e3'`;
    await db`UPDATE employees SET phone_canonical = NULL WHERE id = 'e2'`;
  });

  it("crew_links: ein Link je Person, Token eindeutig und im Format, Kaskade", async () => {
    await db`INSERT INTO crew_links (id, workspace_id, employee_id, token) VALUES ('l1', 'w1', 'e1', ${token})`;
    await expect(db`INSERT INTO crew_links (id, workspace_id, employee_id, token) VALUES ('l2', 'w1', 'e1', ${"B".repeat(32)})`).rejects.toThrow(/crew_links_employee_uq/);
    await expect(db`INSERT INTO crew_links (id, workspace_id, employee_id, token) VALUES ('l2', 'w1', 'e2', ${token})`).rejects.toThrow(/crew_links_token_uq/);
    await expect(db`INSERT INTO crew_links (id, workspace_id, employee_id, token) VALUES ('l2', 'w1', 'e2', 'kurz')`).rejects.toThrow(/crew_links_token_format/);
    const [l] = await db`SELECT view_count, revoked_at, last_seen_at FROM crew_links WHERE id = 'l1'`;
    expect(l).toMatchObject({ view_count: 0, revoked_at: null, last_seen_at: null });
  });

  it("crew_job_responses: Antworten und Quelle geprüft, eine Antwort je Paar", async () => {
    const ins = (id: string, emp: string, answer: string, source = "portal") =>
      db`INSERT INTO crew_job_responses (id, workspace_id, deal_record_id, employee_id, answer, source) VALUES (${id}, 'w1', 'd1', ${emp}, ${answer}, ${source})`;
    await expect(ins("r0", "e1", "bestaetigt")).rejects.toThrow(/answer_check/);
    await expect(ins("r0", "e1", "ja", "whatsapp")).rejects.toThrow(/source_check/);
    for (const a of ["ja", "vielleicht", "nein", "warteliste"]) {
      await ins(`r-${a}`, "e1", a);
      await db`DELETE FROM crew_job_responses WHERE id = ${`r-${a}`}`;
    }
    await ins("r1", "e1", "ja");
    await expect(ins("r2", "e1", "nein")).rejects.toThrow(/crew_job_responses_deal_employee_uq/);
    await ins("r2", "e2", "nein", "crm");
  });

  it("Foto-Spalten leer im Bestand; Löschen der Person räumt Link und Antworten", async () => {
    expect((await db`SELECT crew_freigegeben_at, crew_freigegeben_by FROM inbox_message_attachments`)[0]).toEqual({
      crew_freigegeben_at: null,
      crew_freigegeben_by: null,
    });
    await db`DELETE FROM employees WHERE id = 'e1'`;
    expect((await db`SELECT count(*)::int AS n FROM crew_links`)[0]!.n).toBe(0);
    expect((await db`SELECT count(*)::int AS n FROM crew_job_responses WHERE employee_id = 'e1'`)[0]!.n).toBe(0);
  });
});
