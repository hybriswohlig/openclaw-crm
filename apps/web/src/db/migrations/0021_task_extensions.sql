-- Subtasks, recurrence flag, and overdue-notification tracking.
ALTER TABLE "tasks"
  ADD COLUMN IF NOT EXISTS "parent_task_id" text REFERENCES "tasks"("id") ON DELETE CASCADE;

ALTER TABLE "tasks"
  ADD COLUMN IF NOT EXISTS "recurrence_rule" text;
-- Values: NULL = one-shot; 'daily'|'weekly'|'monthly' for the common cases.

ALTER TABLE "tasks"
  ADD COLUMN IF NOT EXISTS "recurrence_anchor" timestamp;
-- The timestamp the "next instance" is scheduled to fire from. Updated
-- after each instance is materialised.

ALTER TABLE "tasks"
  ADD COLUMN IF NOT EXISTS "overdue_notified_at" timestamp;
-- Set when the overdue cron has already pinged the workspace about this
-- task. Re-set to NULL automatically when the deadline changes (via the
-- updateTask code path).

CREATE INDEX IF NOT EXISTS "tasks_parent_task_id" ON "tasks" ("parent_task_id");
CREATE INDEX IF NOT EXISTS "tasks_overdue_lookup_idx"
  ON "tasks" ("deadline") WHERE "is_completed" = false;
