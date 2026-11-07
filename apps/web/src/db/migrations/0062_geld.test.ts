import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync(new URL("./0062_geld.sql", import.meta.url), "utf8");
const kompakt = sql.replace(/\s+/g, " ");

describe("Migration 0062 Geld", () => {
  it("legt Rechnungen und Erinnerungen idempotent an", () => {
    expect(kompakt).toContain('CREATE TABLE IF NOT EXISTS "deal_invoices"');
    expect(kompakt).toContain('CREATE TABLE IF NOT EXISTS "payment_reminders"');
    expect(kompakt).toContain("CHECK (\"herkunft\" IN ('crm', 'vps', 'upload', 'alt'))");
    expect(kompakt).toContain("CHECK (\"status\" IN ('entwurf', 'gestellt', 'storniert', 'verworfen'))");
    expect(kompakt).toContain('ON "deal_invoices" ("workspace_id", "operating_company_id", "nummer") WHERE "nummer" IS NOT NULL');
    expect(kompakt).toContain('ON "deal_invoices" ("deal_record_id") WHERE "status" IN (\'entwurf\', \'gestellt\')');
    expect(kompakt).toContain('ON "payment_reminders" ("invoice_id", "stufe")');
    expect(sql).not.toMatch(/\bDROP\b/i);
    expect(sql).not.toMatch(/\bDELETE\b/i);
    expect(sql).not.toMatch(/\bUPDATE "/);
    for (const m of kompakt.matchAll(/CREATE (UNIQUE )?INDEX (\w+ )*/g)) {
      expect(kompakt.slice(m.index!, m.index! + 60)).toMatch(/IF NOT EXISTS/);
    }
  });

  it("ergänzt nur Spalten mit IF NOT EXISTS", () => {
    for (const s of [
      'ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "quelle" text',
      'ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "employee_id" text',
      'ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "bar_erhalten_am" timestamptz',
      'ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "bar_erhalten_von" text',
      'ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "storno_von_payment_id" text',
      'ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "storno_grund" text',
      'ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "created_by" text',
      'ALTER TABLE "company_settings" ADD COLUMN IF NOT EXISTS "zahlungsziel_basis" text NOT NULL DEFAULT \'umzugstag\'',
      'ALTER TABLE "company_settings" ADD COLUMN IF NOT EXISTS "zahlungsziel_tage" integer NOT NULL DEFAULT 0',
      'ALTER TABLE "company_settings" ADD COLUMN IF NOT EXISTS "erinnerung_modus" text NOT NULL DEFAULT \'aus\'',
      'ALTER TABLE "company_settings" ADD COLUMN IF NOT EXISTS "erinnerung_tage" integer NOT NULL DEFAULT 7',
      'ALTER TABLE "company_settings" ADD COLUMN IF NOT EXISTS "erinnerung2_tage" integer NOT NULL DEFAULT 14',
      'ALTER TABLE "company_settings" ADD COLUMN IF NOT EXISTS "steuernummer" text',
      'ALTER TABLE "deal_workflow_state" ADD COLUMN IF NOT EXISTS "bezahlt_am" timestamptz',
      'ALTER TABLE "document_render_jobs" ADD COLUMN IF NOT EXISTS "invoice_id" text',
    ]) expect(kompakt).toContain(s);
    const alter = kompakt.match(/ALTER TABLE "\w+" ADD (\w+ )+/g) ?? [];
    for (const a of alter) expect(a).toContain("ADD COLUMN IF NOT EXISTS");
  });

  it("übernimmt je Deal nur die neueste Altrechnung, ohne Nummer", () => {
    expect(kompakt).toContain('SELECT DISTINCT ON (dd."deal_record_id")');
    expect(kompakt).toContain("'alt', 'gestellt'");
    expect(kompakt).toContain('WHERE dd."document_type" = \'invoice\' AND NOT EXISTS (SELECT 1 FROM "deal_invoices" di WHERE di."deal_record_id" = dd."deal_record_id")');
    expect(kompakt).toContain('ORDER BY dd."deal_record_id", dd."uploaded_at" DESC');
    expect(kompakt).toContain("a.\"slug\" = 'rechnung_faellig_am'");
    expect(kompakt).toContain("AT TIME ZONE 'Europe/Berlin'");
  });

  it("steht im Journal als idx 62", () => {
    const journal = JSON.parse(readFileSync(new URL("./meta/_journal.json", import.meta.url), "utf8"));
    expect(journal.entries.find((e: { idx: number }) => e.idx === 62)).toMatchObject({ tag: "0062_geld", when: 1793577600000 });
  });
});
