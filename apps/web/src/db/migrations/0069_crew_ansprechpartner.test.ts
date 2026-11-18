import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync(new URL("./0069_crew_ansprechpartner.sql", import.meta.url), "utf8");

describe("Migration 0069 Crew-Ansprechpartner (Text)", () => {
  it("nur eine neue Tabelle mit Index, idempotent, nichts gelöscht oder geändert", () => {
    const ohneFk = sql.replace(/ON (DELETE|UPDATE) (CASCADE|SET NULL)/g, "");
    expect(ohneFk).not.toMatch(/\b(DROP|DELETE|UPDATE|ALTER)\b/i);
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS "crew_ansprechpartner"');
    expect(sql).toContain('CREATE INDEX IF NOT EXISTS "crew_ansprechpartner_workspace_idx"');
  });

  it("steht im Journal als idx 69", () => {
    const journal = JSON.parse(readFileSync(new URL("./meta/_journal.json", import.meta.url), "utf8"));
    expect(journal.entries.find((e: { idx: number }) => e.idx === 69)).toMatchObject({ tag: "0069_crew_ansprechpartner" });
  });
});
