import { readFileSync } from "node:fs";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const sql = readFileSync(new URL("./0067_crew_briefing.sql", import.meta.url), "utf8");
const schritte = sql.split("--> statement-breakpoint").map((s) => s.trim()).filter(Boolean);

describe("Migration 0067 Crew-Briefing (Text)", () => {
  it("nur additiv und idempotent", () => {
    expect(sql).not.toMatch(/\bDROP\b/i);
    const ohneFk = sql.replace(/ON (DELETE|UPDATE) (CASCADE|SET NULL)/g, "");
    expect(ohneFk).not.toMatch(/\bDELETE\b/i);
    expect(ohneFk).not.toMatch(/\bUPDATE\b/i);
    expect(sql).not.toMatch(/ALTER TABLE "(employees|records|workspaces|deal_employees)"/);
    for (const zeile of sql.split("\n")) {
      if (/^\s*CREATE (UNIQUE )?INDEX/.test(zeile)) expect(zeile).toMatch(/INDEX IF NOT EXISTS/);
      if (/^\s*CREATE TABLE/.test(zeile)) expect(zeile).toContain("CREATE TABLE IF NOT EXISTS");
    }
  });

  it("steht im Journal als idx 67", () => {
    const journal = JSON.parse(readFileSync(new URL("./meta/_journal.json", import.meta.url), "utf8"));
    expect(journal.entries.find((e: { idx: number }) => e.idx === 67)).toMatchObject({ tag: "0067_crew_briefing" });
    const idx = journal.entries.map((e: { idx: number }) => e.idx);
    expect(new Set(idx).size).toBe(idx.length);
  });
});

const url = process.env.EINSATZ_TEST_DATABASE_URL;

describe.skipIf(!url)("Migration 0067 Crew-Briefing (DB)", () => {
  let db: postgres.Sql;
  const schema = `m0067_${Date.now().toString(36)}`;
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
      CREATE TABLE employees (id text PRIMARY KEY);
      INSERT INTO workspaces VALUES ('w1'); INSERT INTO records VALUES ('d1'); INSERT INTO employees VALUES ('e1');
    `);
    await lauf();
  });

  afterAll(async () => {
    await db?.unsafe(`DROP SCHEMA ${schema} CASCADE`);
    await db?.end();
  });

  it("zweiter Lauf ändert nichts und Daten bleiben", async () => {
    await db.unsafe(`INSERT INTO crew_briefings (deal_record_id, workspace_id) VALUES ('d1', 'w1')`);
    await lauf();
    expect(await db.unsafe(`SELECT count(*)::int AS n FROM crew_briefings`)).toEqual([{ n: 1 }]);
  });

  it("Prüfungen greifen: unbekannter Status und doppeltes Gelesen", async () => {
    await expect(
      db.unsafe(`INSERT INTO crew_notifications (id, workspace_id, deal_record_id, employee_id, kind, release_at, status) VALUES ('n1', 'w1', 'd1', 'e1', 'briefing', now(), 'egal')`),
    ).rejects.toThrow(/crew_notifications_status_check/);
    await db.unsafe(`INSERT INTO crew_briefing_reads (id, workspace_id, deal_record_id, employee_id, release_at) VALUES ('r1', 'w1', 'd1', 'e1', '2026-01-01')`);
    await expect(
      db.unsafe(`INSERT INTO crew_briefing_reads (id, workspace_id, deal_record_id, employee_id, release_at) VALUES ('r2', 'w1', 'd1', 'e1', '2026-01-01')`),
    ).rejects.toThrow(/crew_briefing_reads_uq/);
  });
});
