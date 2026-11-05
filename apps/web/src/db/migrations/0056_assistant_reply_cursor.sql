-- Lead-Assistent: letzte bearbeitete Kundennachricht und Ergebnis.
-- Alle Spalten nullable. Bestehende Zeilen bleiben NULL und gelten als
-- „noch nie gelaufen“. Kein Backfill, keine Änderung an alten Werten.
-- ai_last_assistant_action: ask | handoff | no_op (App-seitig geprüft).
-- ai_last_assistant_inbound_at: created_at der abgedeckten Kundennachricht.
-- ai_last_assistant_at: Zeitpunkt des letzten LLM-Aufrufs (Stundenlimit).

ALTER TABLE "inbox_conversations"
  ADD COLUMN IF NOT EXISTS "ai_last_assistant_inbound_id" text,
  ADD COLUMN IF NOT EXISTS "ai_last_assistant_inbound_at" timestamp,
  ADD COLUMN IF NOT EXISTS "ai_last_assistant_action" text,
  ADD COLUMN IF NOT EXISTS "ai_last_assistant_at" timestamp;
