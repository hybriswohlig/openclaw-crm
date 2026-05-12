-- Explicit kanban column for tasks. Nullable: when null, the kanban falls
-- back to deriving the column from isCompleted + deadline + linkedRecords
-- (the original Wave-1 behaviour). When the user drags a task to a
-- specific column the explicit value is written so the placement sticks
-- even if the derivation would put it elsewhere.
ALTER TABLE "tasks"
  ADD COLUMN IF NOT EXISTS "kanban_status" text;
-- Valid values: 'backlog' | 'heute' | 'laeuft' | 'warte' | 'erledigt'
