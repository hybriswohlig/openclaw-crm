-- Fibonacci point estimate for tasks. Drives the Team-Pulse weekly score so
-- members working on bigger tasks (split into subtasks) get fair credit
-- compared to members closing many small tasks. Nullable; aggregation
-- treats null as 1 so existing rows still count.
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "point_estimate" integer;
