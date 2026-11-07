import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync(new URL("./0061_pakete_tage.sql", import.meta.url), "utf8");
const kompakt = sql.replace(/\s+/g, " ");

describe("Migration 0061 Pakete und Tage", () => {
  it("ergänzt nur Spalten, idempotent", () => {
    for (const s of [
      'ALTER TABLE "deal_calculation_versions" ADD COLUMN IF NOT EXISTS "day_prices" jsonb NOT NULL DEFAULT \'[]\'::jsonb',
      'ALTER TABLE "quotation_date_offers" ADD COLUMN IF NOT EXISTS "price_cents" integer',
      'ALTER TABLE "quotation_date_offers" ADD COLUMN IF NOT EXISTS "package_prices" jsonb',
      'ALTER TABLE "quotation_date_offers" ADD COLUMN IF NOT EXISTS "calculation_version_id" text',
      'ALTER TABLE "quotation_date_offers" ADD COLUMN IF NOT EXISTS "vehicle_booking_id" text',
      'ALTER TABLE "quotation_package_options" ADD COLUMN IF NOT EXISTS "calculation_version_id" text',
      'ALTER TABLE "kva_confirmations" ADD COLUMN IF NOT EXISTS "selected_date_offer_id" text',
      'ALTER TABLE "kva_confirmations" ADD COLUMN IF NOT EXISTS "selected_date" date',
      'ALTER TABLE "operating_company_portal_settings" ADD COLUMN IF NOT EXISTS "angebot_aus_kalkulation" boolean NOT NULL DEFAULT false',
      'ALTER TABLE "operating_company_portal_settings" ADD COLUMN IF NOT EXISTS "tagespreise_enabled" boolean NOT NULL DEFAULT false',
    ]) expect(kompakt).toContain(s);
    expect(sql).not.toMatch(/\bDROP\b/i);
    expect(sql).not.toMatch(/day_factor/);
  });

  it("Fremdschlüssel mit SET NULL, nur wenn noch nicht da", () => {
    expect(kompakt.match(/IF NOT EXISTS \(SELECT 1 FROM pg_constraint/g)?.length).toBe(3);
    expect(kompakt.match(/ON DELETE SET NULL/g)?.length).toBe(3);
  });

  it("setzt Hebel nach F6 nur für leere Pakete", () => {
    expect(kompakt).toContain("UPDATE \"offer_packages\" SET \"hebel\" = '[\"halteverbot\", \"montage\"]'::jsonb WHERE \"slug\" = 'komfort' AND \"hebel\" = '[]'::jsonb");
    expect(kompakt).toContain("UPDATE \"offer_packages\" SET \"hebel\" = '[\"halteverbot\", \"montage\", \"einpacken\", \"kueche\"]'::jsonb WHERE \"slug\" = 'premium' AND \"hebel\" = '[]'::jsonb");
    expect(sql).not.toMatch(/slug" = 'basis'/);
  });

  it("steht im Journal als idx 61", () => {
    const journal = JSON.parse(readFileSync(new URL("./meta/_journal.json", import.meta.url), "utf8"));
    expect(journal.entries.find((e: { idx: number }) => e.idx === 61)).toMatchObject({ tag: "0061_pakete_tage", when: 1793491200000 });
  });
});
