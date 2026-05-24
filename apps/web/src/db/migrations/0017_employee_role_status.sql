-- Add primary role + employment status to employees so the team dashboard
-- (KOT-589) can render the v1 row without falling back to per-deal role
-- aggregation. Both columns are additive:
--   * role: nullable text (free-form, suggested values driver/packer/mover/helper)
--   * status: enum, defaults to 'active' so existing rows surface immediately
-- Idempotent so re-running against an already-migrated DB is safe.

DO $$ BEGIN
  CREATE TYPE "employee_status" AS ENUM ('active', 'on_leave', 'inactive');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

ALTER TABLE "employees"
  ADD COLUMN IF NOT EXISTS "role" text;

ALTER TABLE "employees"
  ADD COLUMN IF NOT EXISTS "status" "employee_status" NOT NULL DEFAULT 'active';
