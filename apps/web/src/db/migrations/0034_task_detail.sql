-- Task detail fields: a free-text description and an optional priority.
-- Both nullable, so every existing task reads as "no description, no
-- priority" and nothing changes for current data.
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "description" text;
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "priority" text;
-- priority valid values (app-enforced): 'niedrig' | 'mittel' | 'hoch'
