-- wa_lid becomes a HARD identity key (LID conversation-split fix, Phase 2).
-- The ingest path now records `<digits>@lid` as person_identifiers kind
-- 'wa_lid' and the D1 deterministic auto-merge fires on wa_lid collisions,
-- so the hard-key partial unique index must cover it like phone/email.
--
-- Defensive dedupe first: wa_lid rows are written by the same deploy that
-- ships this migration, and the unguarded select-then-insert in
-- upsertIdentifier can have minted duplicates in the window before the
-- migration runs. Keep the oldest row per (workspace, canonical), drop the
-- rest; identifier ownership of the survivors is reconciled by the next
-- ingest via the merge path.
DELETE FROM "person_identifiers" pi
USING "person_identifiers" keep
WHERE pi."kind" = 'wa_lid'
  AND keep."kind" = 'wa_lid'
  AND pi."workspace_id" = keep."workspace_id"
  AND pi."value_canonical" = keep."value_canonical"
  AND pi."value_canonical" IS NOT NULL
  AND (keep."created_at" < pi."created_at"
       OR (keep."created_at" = pi."created_at" AND keep."id" < pi."id"));
--> statement-breakpoint
DROP INDEX IF EXISTS "person_identifiers_hardkey_uniq";
--> statement-breakpoint
CREATE UNIQUE INDEX "person_identifiers_hardkey_uniq"
  ON "person_identifiers" ("workspace_id", "kind", "value_canonical")
  WHERE "kind" IN ('phone', 'email', 'wa_lid') AND "value_canonical" IS NOT NULL;
