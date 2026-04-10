ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "approval_status" text NOT NULL DEFAULT 'approved';
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "is_app_admin" boolean NOT NULL DEFAULT false;
ALTER TABLE "users" ALTER COLUMN "approval_status" SET DEFAULT 'pending';
