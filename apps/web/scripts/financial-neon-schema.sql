-- Run this in Neon: Dashboard → SQL Editor → paste → Run.
-- Creates the tables the Financial overview expects (public schema, lowercase names).

CREATE TABLE IF NOT EXISTS public.zahlungen (
  id SERIAL PRIMARY KEY,
  auftrag_nr TEXT NOT NULL,
  datum DATE NOT NULL,
  betrag NUMERIC(14, 2) NOT NULL,
  zahler TEXT NOT NULL,
  zahlungsart TEXT NOT NULL,
  referenz TEXT,
  notiz TEXT,
  erstellt_am TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.ausgaben (
  id SERIAL PRIMARY KEY,
  datum DATE NOT NULL,
  betrag NUMERIC(14, 2) NOT NULL,
  empfaenger TEXT NOT NULL,
  beschreibung TEXT,
  kategorie TEXT,
  zahlungsart TEXT,
  auftrag_nr TEXT,
  firma TEXT,
  beleg_datei TEXT,
  erstellt_am TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.mitarbeiter_konten (
  id SERIAL PRIMARY KEY,
  mitarbeiter TEXT NOT NULL,
  datum DATE NOT NULL,
  typ TEXT NOT NULL,
  betrag NUMERIC(14, 2) NOT NULL,
  beschreibung TEXT,
  auftrag_nr TEXT,
  status TEXT NOT NULL DEFAULT 'offen',
  zahlungsart TEXT,
  notiz TEXT,
  erstellt_am TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Either maintain this table manually / import, or replace with the view below after dropping the table.
CREATE TABLE IF NOT EXISTS public.mitarbeiter_saldo (
  mitarbeiter TEXT PRIMARY KEY,
  schulden_gesamt NUMERIC(14, 2) NOT NULL DEFAULT 0,
  gezahlt_gesamt NUMERIC(14, 2) NOT NULL DEFAULT 0,
  saldo NUMERIC(14, 2) NOT NULL DEFAULT 0,
  anzahl_transaktionen INTEGER NOT NULL DEFAULT 0
);

-- Optional: live balances from mitarbeiter_konten (uncomment if you do NOT use the table above)
-- DROP TABLE IF EXISTS public.mitarbeiter_saldo;
-- CREATE OR REPLACE VIEW public.mitarbeiter_saldo AS
-- SELECT
--   mitarbeiter,
--   COALESCE(SUM(CASE WHEN typ IN ('lohn', 'auslage') THEN betrag ELSE 0 END), 0)::numeric(14,2) AS schulden_gesamt,
--   COALESCE(SUM(CASE WHEN typ = 'erstattung' THEN betrag ELSE 0 END), 0)::numeric(14,2) AS gezahlt_gesamt,
--   (COALESCE(SUM(CASE WHEN typ IN ('lohn', 'auslage') THEN betrag ELSE 0 END), 0)
--    - COALESCE(SUM(CASE WHEN typ = 'erstattung' THEN betrag ELSE 0 END), 0))::numeric(14,2) AS saldo,
--   COUNT(*)::integer AS anzahl_transaktionen
-- FROM public.mitarbeiter_konten
-- GROUP BY mitarbeiter;

CREATE INDEX IF NOT EXISTS idx_zahlungen_datum ON public.zahlungen (datum DESC);
CREATE INDEX IF NOT EXISTS idx_ausgaben_datum ON public.ausgaben (datum DESC);
CREATE INDEX IF NOT EXISTS idx_mitarbeiter_konten_datum ON public.mitarbeiter_konten (datum DESC);
