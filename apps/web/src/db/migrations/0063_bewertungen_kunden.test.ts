import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const sqlText = readFileSync(new URL("./0063_bewertungen_kunden.sql", import.meta.url), "utf8");
const kompakt = sqlText.replace(/\s+/g, " ");

describe("Migration 0063 Bewertungen und Kunden (Text)", () => {
  it("ist additiv und idempotent geschrieben", () => {
    expect(sqlText).not.toMatch(/\bDROP\b/i);
    expect(sqlText).not.toMatch(/DELETE FROM/i);
    for (const m of kompakt.matchAll(/CREATE (UNIQUE )?INDEX (\w+ )*/g)) {
      expect(kompakt.slice(m.index!, m.index! + 60)).toMatch(/IF NOT EXISTS/);
    }
    const alter = kompakt.match(/ALTER TABLE "\w+" ADD (\w+ )+/g) ?? [];
    expect(alter.length).toBe(6);
    for (const a of alter) expect(a).toContain("ADD COLUMN IF NOT EXISTS");
    expect(kompakt).toContain('CREATE TABLE IF NOT EXISTS "review_vormerkungen"');
    // Der einzige UPDATE ist der Datenschritt und trifft nur Token ohne Quelle.
    expect(kompakt.match(/\bUPDATE "/g)?.length).toBe(1);
    expect(kompakt).toContain('WHERE t."quelle" IS NULL;');
  });

  it("legt CHECKs und Indizes an", () => {
    expect(kompakt).toContain("CHECK (\"bewertung_modus\" IN ('aus', 'entwurf', 'senden'))");
    expect(kompakt).toContain("CHECK (\"zustand\" IN ('anspruch', 'gesendet', 'unklar'))");
    expect(kompakt).toContain("CHECK (\"quelle\" IS NULL OR \"quelle\" IN ('hand', 'vorgemerkt', 'automatik', 'alt'))");
    expect(kompakt).toContain("CHECK (\"art\" IN ('hand', 'entwurf', 'auto'))");
    expect(kompakt).toContain("CHECK (\"status\" IN ('offen', 'gesendet', 'verworfen', 'gesperrt'))");
    expect(kompakt).toContain('ON "review_vormerkungen" ("workspace_id", "deal_record_id") WHERE "status" = \'offen\'');
    expect(kompakt).toContain('ON "review_vormerkungen" ("status", "faellig_ab")');
    expect(kompakt).toContain('ON "review_tokens" ("workspace_id", "zustand")');
    expect(kompakt).toContain('WHERE "click_ip" IS NOT NULL OR "click_user_agent" IS NOT NULL');
  });

  it("steht im Journal als idx 63 nach 62", () => {
    const journal = JSON.parse(readFileSync(new URL("./meta/_journal.json", import.meta.url), "utf8"));
    const e63 = journal.entries.find((e: { idx: number }) => e.idx === 63);
    const e62 = journal.entries.find((e: { idx: number }) => e.idx === 62);
    expect(e63).toMatchObject({ tag: "0063_bewertungen_kunden", when: 1793664000000 });
    expect(e63.when).toBeGreaterThan(e62.when);
  });
});

/**
 * Gegen eine Wegwerf-Datenbank (Schema per drizzle-kit push, also schon mit
 * den Spalten): Datenschritt, zweiter Lauf, CHECKs und Unique-Index. Läuft
 * nur mit BEWERTUNG_TEST_DATABASE_URL.
 */
const url = process.env.BEWERTUNG_TEST_DATABASE_URL;

describe.skipIf(!url)("Migration 0063 gegen Postgres", () => {
  let sql: postgres.Sql;
  const ws = randomUUID();
  const obj = randomUUID();
  const deal = randomUUID();
  const deal2 = randomUUID();

  async function migrieren() {
    for (const teil of sqlText.split("--> statement-breakpoint")) {
      if (teil.trim()) await sql.unsafe(teil);
    }
  }

  beforeAll(async () => {
    sql = postgres(url!, { max: 1, onnotice: () => {} });
    await sql`insert into workspaces (id, name, slug) values (${ws}, 'Mig 0063', ${`m-${ws}`})`;
    await sql`insert into objects (id, workspace_id, slug, singular_name, plural_name) values (${obj}, ${ws}, 'deals', 'Deal', 'Deals')`;
    await sql`insert into records (id, object_id) values (${deal}, ${obj}), (${deal2}, ${obj})`;
    const t0 = "2026-06-01T10:00:00";
    // Altbestand: quelle null, zustand Standard.
    await sql`insert into review_tokens (token, workspace_id, deal_record_id, destination_url, created_at, clicked_at)
      values ('klick', ${ws}, ${deal}, 'https://g.page/x', ${t0}::text::timestamp, ${t0}::text::timestamp),
             ('genau', ${ws}, ${deal}, 'https://g.page/x', ${t0}::text::timestamp, null),
             ('ungefaehr', ${ws}, ${deal2}, 'https://g.page/x', ${t0}::text::timestamp, null),
             ('waise', ${ws}, ${deal}, 'https://g.page/x', '2026-06-02T10:00:00', null),
             ('neu', ${ws}, ${deal2}, 'https://g.page/x', ${t0}::text::timestamp, null)`;
    await sql`update review_tokens set quelle = 'hand', zustand = 'anspruch' where token = 'neu'`;
    await sql`insert into review_events (id, workspace_id, deal_record_id, event_type, channel, meta, at)
      values (gen_random_uuid()::text, ${ws}, ${deal}, 'sent_whatsapp', 'whatsapp', ${sql.json({ token: "genau" })}, '2026-06-01T10:00:05'),
             (gen_random_uuid()::text, ${ws}, ${deal}, 'sent_whatsapp', 'whatsapp', ${sql.json({ token: "anders" })}, '2026-06-02T10:00:10'),
             (gen_random_uuid()::text, ${ws}, ${deal2}, 'sent_sms', 'sms', ${sql.json({})}, '2026-06-01T10:00:30')`;
  });

  afterAll(async () => {
    if (!sql) return;
    await sql`delete from review_vormerkungen where workspace_id = ${ws}`;
    await sql`delete from review_events where workspace_id = ${ws}`;
    await sql`delete from review_tokens where workspace_id = ${ws}`;
    await sql`delete from records where object_id = ${obj}`;
    await sql`delete from objects where id = ${obj}`;
    await sql`delete from workspaces where id = ${ws}`;
    await sql.end({ timeout: 5 });
  });

  async function stand() {
    const rows = await sql<{ token: string; zustand: string; quelle: string | null; zustand_at: Date | null }[]>`
      select token, zustand, quelle, zustand_at from review_tokens where workspace_id = ${ws} order by token`;
    return Object.fromEntries(rows.map((r) => [r.token, r]));
  }

  it("ordnet Altbestand zu und lässt neue Token stehen", async () => {
    await migrieren();
    const s = await stand();
    expect(s.klick).toMatchObject({ zustand: "gesendet", quelle: "alt" });
    expect(s.genau).toMatchObject({ zustand: "gesendet", quelle: "alt" });
    expect(s.ungefaehr).toMatchObject({ zustand: "gesendet", quelle: "alt" });
    // Ereignis mit anderem Token zählt nicht, ohne Token-Ereignis bis 1 Minute keins.
    expect(s.waise).toMatchObject({ zustand: "unklar", quelle: "alt" });
    expect(s.waise!.zustand_at).not.toBeNull();
    expect(s.neu).toMatchObject({ zustand: "anspruch", quelle: "hand", zustand_at: null });
  });

  it("ein zweiter Lauf ändert nichts", async () => {
    const vorher = await stand();
    await migrieren();
    expect(await stand()).toEqual(vorher);
  });

  it("CHECKs greifen", async () => {
    await expect(sql`update review_tokens set zustand = 'kaputt' where token = 'neu'`).rejects.toThrow(/review_tokens_zustand_check/);
    await expect(sql`update review_tokens set quelle = 'kaputt' where token = 'neu'`).rejects.toThrow(/review_tokens_quelle_check/);
    await expect(
      sql`insert into review_vormerkungen (id, workspace_id, deal_record_id, art, faellig_ab, frist_bis)
          values (${randomUUID()}, ${ws}, ${deal}, 'sofort', now(), now())`
    ).rejects.toThrow(/review_vormerkungen_art_check/);
  });

  it("höchstens eine offene Vormerkung je Deal", async () => {
    const neu = (status: string) =>
      sql`insert into review_vormerkungen (id, workspace_id, deal_record_id, art, status, faellig_ab, frist_bis)
          values (${randomUUID()}, ${ws}, ${deal}, 'auto', ${status}, now(), now() + interval '1 day')`;
    await neu("offen");
    await expect(neu("offen")).rejects.toThrow(/review_vormerkungen_offen_uniq/);
    await neu("gesendet");
    await neu("verworfen");
    const [z] = await sql<{ n: number }[]>`select count(*)::int as n from review_vormerkungen where deal_record_id = ${deal}`;
    expect(z!.n).toBe(3);
  });
});
