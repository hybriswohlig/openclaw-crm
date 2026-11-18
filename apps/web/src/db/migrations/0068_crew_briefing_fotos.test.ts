import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync(new URL("./0068_crew_briefing_fotos.sql", import.meta.url), "utf8");

describe("Migration 0068 Crew-Briefing-Fotos (Text)", () => {
  it("nur zwei neue Spalten, idempotent, nichts gelöscht oder geändert", () => {
    expect(sql).not.toMatch(/\b(DROP|DELETE|UPDATE)\b/i);
    const zeilen = sql.split("\n").filter((z) => /^\s*ALTER TABLE/.test(z));
    expect(zeilen).toHaveLength(2);
    for (const z of zeilen) expect(z).toMatch(/^ALTER TABLE "inbox_message_attachments" ADD COLUMN IF NOT EXISTS "crew_gesperrt_(at|by)" (timestamptz|text);$/);
  });

  it("steht im Journal als idx 68", () => {
    const journal = JSON.parse(readFileSync(new URL("./meta/_journal.json", import.meta.url), "utf8"));
    expect(journal.entries.find((e: { idx: number }) => e.idx === 68)).toMatchObject({ tag: "0068_crew_briefing_fotos" });
    const idx = journal.entries.map((e: { idx: number }) => e.idx);
    expect(new Set(idx).size).toBe(idx.length);
  });
});
