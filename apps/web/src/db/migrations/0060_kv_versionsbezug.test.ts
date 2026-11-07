import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync(new URL("./0060_kv_versionsbezug.sql", import.meta.url), "utf8");
const kompakt = sql.replace(/\s+/g, " ");

describe("Migration 0060 KV-Versionsbezug", () => {
  it("legt das Job-Register idempotent an", () => {
    expect(kompakt).toContain('CREATE TABLE IF NOT EXISTS "document_render_jobs"');
    expect(kompakt).toContain('CREATE INDEX IF NOT EXISTS "document_render_jobs_status_idx" ON "document_render_jobs" ("status", "created_at")');
    expect(kompakt).toContain('CREATE INDEX IF NOT EXISTS "document_render_jobs_deal_idx" ON "document_render_jobs" ("workspace_id", "deal_record_id")');
    expect(kompakt).toContain("CHECK (\"status\" in ('laeuft', 'abgelegt', 'verworfen', 'fehler'))");
    expect(sql).not.toMatch(/\bDROP\b/i);
  });

  it("hat die Fremdschlüssel", () => {
    expect(kompakt).toContain('"deal_record_id" text NOT NULL REFERENCES "records"("id") ON DELETE CASCADE');
    expect(kompakt).toContain('"calculation_version_id" text REFERENCES "deal_calculation_versions"("id") ON DELETE SET NULL');
    expect(kompakt).toContain('"deal_document_id" text REFERENCES "deal_documents"("id") ON DELETE SET NULL');
  });

  it("ergänzt kva_confirmations nur additiv und idempotent", () => {
    expect(kompakt).toContain('ALTER TABLE "kva_confirmations" ADD COLUMN IF NOT EXISTS "calculation_version_id" text');
    expect(kompakt).toContain("conname = 'kva_confirmations_calculation_version_fk'");
    expect(sql).not.toMatch(/\bUPDATE\b/i);
  });

  it("steht im Journal als idx 60", () => {
    const journal = JSON.parse(readFileSync(new URL("./meta/_journal.json", import.meta.url), "utf8"));
    const eintrag = journal.entries.find((e: { idx: number }) => e.idx === 60);
    expect(eintrag).toMatchObject({ tag: "0060_kv_versionsbezug", when: 1793404800000 });
  });
});
