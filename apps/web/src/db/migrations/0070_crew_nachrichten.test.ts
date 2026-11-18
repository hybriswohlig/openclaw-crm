import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync(new URL("./0070_crew_nachrichten.sql", import.meta.url), "utf8");

describe("Migration 0070 Crew-Nachrichten (Text)", () => {
  it("lockert nur Bedingungen und legt eine Tabelle an; löscht keine Daten", () => {
    const ohneFk = sql.replace(/ON (DELETE|UPDATE) (CASCADE|SET NULL)/g, "");
    expect(ohneFk).not.toMatch(/\b(DROP TABLE|DROP COLUMN|DELETE|UPDATE|TRUNCATE)\b/i);
    expect(sql).toContain('ALTER COLUMN "release_at" DROP NOT NULL');
    expect(sql).toContain("CHECK (\"kind\" IN ('briefing', 'zusage', 'neue_jobs'))");
    expect(sql).toContain('DROP CONSTRAINT IF EXISTS "crew_notifications_kind_check"');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS "crew_job_announcements"');
    expect(sql).toContain('CREATE UNIQUE INDEX IF NOT EXISTS "crew_job_announcements_uq"');
  });

  it("steht im Journal als idx 70", () => {
    const journal = JSON.parse(readFileSync(new URL("./meta/_journal.json", import.meta.url), "utf8"));
    expect(journal.entries.find((e: { idx: number }) => e.idx === 70)).toMatchObject({ tag: "0070_crew_nachrichten" });
  });
});
