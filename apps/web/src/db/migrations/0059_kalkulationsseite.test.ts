import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync(new URL("./0059_kalkulationsseite.sql", import.meta.url), "utf8");
const kompakt = sql.replace(/\s+/g, " ");

describe("Migration 0059 Kalkulationsseite", () => {
  it("legt beide Tabellen idempotent an", () => {
    expect(kompakt).toContain('CREATE TABLE IF NOT EXISTS "street_view_images"');
    expect(kompakt).toContain('CREATE TABLE IF NOT EXISTS "deal_calculation_routes"');
    expect(kompakt).toContain('CREATE UNIQUE INDEX IF NOT EXISTS "street_view_images_ws_adresse_unique" ON "street_view_images" ("workspace_id", "adresse_schluessel")');
    expect(sql).not.toMatch(/ALTER\s+TABLE/i);
    expect(sql).not.toMatch(/\bDROP\b/i);
  });

  it("hat CHECK auf status und die Fremdschlüssel", () => {
    expect(kompakt).toContain("CHECK (\"status\" in ('ok', 'kein_bild', 'fehler'))");
    expect(kompakt).toContain('"notiz_von" text REFERENCES "users"("id") ON DELETE SET NULL');
    expect(kompakt).toContain('REFERENCES "deal_calculation_versions"("id") ON DELETE CASCADE');
  });

  it("speichert keine Koordinaten", () => {
    expect(sql).not.toMatch(/\b(lat|lng|latitude|longitude)\b/i);
  });

  it("steht im Journal als idx 59", () => {
    const journal = JSON.parse(readFileSync(new URL("./meta/_journal.json", import.meta.url), "utf8"));
    const eintrag = journal.entries.find((e: { idx: number }) => e.idx === 59);
    expect(eintrag).toMatchObject({ tag: "0059_kalkulationsseite", when: 1793318400000 });
    expect(journal.entries.at(-1).idx).toBeGreaterThanOrEqual(59);
  });
});
