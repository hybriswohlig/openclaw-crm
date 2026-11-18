import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync(new URL("./0071_kv_editor.sql", import.meta.url), "utf8");
const ohneKommentare = sql
  .split("\n")
  .filter((z) => !z.trim().startsWith("--"))
  .join("\n");

describe("Migration 0071 KV-Editor (Text)", () => {
  it("nichts gelöscht oder umgeschrieben", () => {
    const ohneFk = ohneKommentare.replace(/ON (DELETE|UPDATE) (CASCADE|SET NULL)/g, "");
    expect(ohneFk).not.toMatch(/\b(DROP|DELETE|UPDATE|TRUNCATE|RENAME)\b/i);
    expect(ohneFk).not.toMatch(/ALTER\s+COLUMN/i);
  });

  it("jede Tabelle, jeder Index und jede Spalte mit IF NOT EXISTS", () => {
    for (const m of ohneKommentare.matchAll(/CREATE\s+(UNIQUE\s+)?(TABLE|INDEX)\s+(?!IF NOT EXISTS)/gi)) {
      throw new Error(`ohne IF NOT EXISTS: ${m[0]}`);
    }
    for (const m of ohneKommentare.matchAll(/ADD\s+COLUMN\s+(?!IF NOT EXISTS)/gi)) {
      throw new Error(`ohne IF NOT EXISTS: ${m[0]}`);
    }
    expect(ohneKommentare).toContain('CREATE TABLE IF NOT EXISTS "kv_staende"');
    expect(ohneKommentare).toContain('ADD COLUMN IF NOT EXISTS "kv_stand_id"');
    expect(ohneKommentare).toContain('ADD COLUMN IF NOT EXISTS "kv_stand_ziel"');
  });

  it("Bedingungen am Job-Register nur in DO-Blöcken mit duplicate_object", () => {
    const constraints = [...ohneKommentare.matchAll(/ADD CONSTRAINT "([^"]+)"/g)].map((m) => m[1]);
    expect(constraints).toEqual([
      "document_render_jobs_kv_stand_fk",
      "document_render_jobs_kv_stand_ziel_chk",
      "document_render_jobs_kv_stand_paar_chk",
    ]);
    expect(ohneKommentare.match(/DO \$\$/g)?.length).toBe(3);
    expect(ohneKommentare.match(/WHEN duplicate_object THEN NULL;/g)?.length).toBe(3);
  });

  it("steht im Journal als idx 71 nach 0070", () => {
    const journal = JSON.parse(readFileSync(new URL("./meta/_journal.json", import.meta.url), "utf8"));
    const e71 = journal.entries.find((e: { idx: number }) => e.idx === 71);
    const e70 = journal.entries.find((e: { idx: number }) => e.idx === 70);
    expect(e71).toMatchObject({ tag: "0071_kv_editor", version: "7", when: 1794355200000, breakpoints: true });
    expect(e71.when).toBeGreaterThan(e70.when);
    expect(journal.entries.at(-1)).toBe(e71);
  });
});
