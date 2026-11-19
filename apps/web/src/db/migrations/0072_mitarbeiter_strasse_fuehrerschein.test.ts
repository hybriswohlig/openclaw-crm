import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync(new URL("./0072_mitarbeiter_strasse_fuehrerschein.sql", import.meta.url), "utf8");

describe("Migration 0072 Mitarbeiter Straße und Führerschein (Text)", () => {
  it("nur zwei neue Spalten und eine Prüfung, idempotent, nichts gelöscht", () => {
    expect(sql).not.toMatch(/\b(DROP|DELETE|UPDATE|TRUNCATE)\b/i);
    expect(sql).toContain('ALTER TABLE "employees" ADD COLUMN IF NOT EXISTS "home_street" text;');
    expect(sql).toContain('ALTER TABLE "employees" ADD COLUMN IF NOT EXISTS "license_class" text;');
    expect(sql).toContain("WHERE conname = 'employees_license_class_check'");
  });

  it("steht im Journal als idx 72", () => {
    const journal = JSON.parse(readFileSync(new URL("./meta/_journal.json", import.meta.url), "utf8"));
    expect(journal.entries.find((e: { idx: number }) => e.idx === 72)).toMatchObject({ tag: "0072_mitarbeiter_strasse_fuehrerschein" });
    const idx = journal.entries.map((e: { idx: number }) => e.idx);
    expect(new Set(idx).size).toBe(idx.length);
  });
});
