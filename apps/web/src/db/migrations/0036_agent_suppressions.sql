-- Per-person agent suppression list (opt-out). When a customer replies STOP (or
-- a clear decline) on any thread, their canonical phone and/or email land here,
-- and all three automated engines (reply, follow-up, first contact) check this
-- list before sending. Keyed by the canonical identity value so an opt-out on
-- one deal/channel suppresses outreach on every other deal/channel for the same
-- person (Art. 21 DSGVO is absolute and person-bound).
CREATE TABLE IF NOT EXISTS "agent_suppressions" (
  "id" text PRIMARY KEY NOT NULL,
  "workspace_id" text NOT NULL,
  -- 'phone' | 'email' (app-enforced, not a DB enum)
  "kind" text NOT NULL,
  -- E.164 for phone, lowercased address for email
  "value_canonical" text NOT NULL,
  "reason" text,
  "source_conversation_id" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "agent_suppressions_workspace_id_workspaces_id_fk"
    FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE
);

-- One suppression per (workspace, kind, canonical value); re-recording an
-- existing opt-out is a no-op (the engines insert with ON CONFLICT DO NOTHING).
CREATE UNIQUE INDEX IF NOT EXISTS "agent_suppressions_ws_kind_value_idx"
  ON "agent_suppressions" ("workspace_id", "kind", "value_canonical");
CREATE INDEX IF NOT EXISTS "agent_suppressions_ws_idx"
  ON "agent_suppressions" ("workspace_id");
