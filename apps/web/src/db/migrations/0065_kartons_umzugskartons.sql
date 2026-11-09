-- Plan 15, Bauteil 13: Die Grundlage-Eingabe `kartons` war bis Plan 15 der
-- Einpackservice (`einpack_kartons`). Was der Inhaber als „15 Kartons“ eintrug,
-- meinte fast immer Umzugskartons zum Transport (der Kunde packt). In ENTWÜRFEN
-- wird der Schlüssel darum zu `umzugskartons` umgedeutet und mit
-- `"umgedeutet": "kartons"` markiert (die Seite zeigt dazu „bitte prüfen“).
-- Gesperrte Versionen bleiben unverändert. Idempotent: ein zweiter Lauf findet
-- keinen Schlüssel `kartons` mehr.
UPDATE "deal_calculation_versions" v
SET "overrides" = (
  SELECT jsonb_agg(
    CASE
      WHEN e->>'art' = 'eingabe' AND e->>'key' = 'kartons'
        THEN e || jsonb_build_object('key', 'umzugskartons', 'umgedeutet', 'kartons')
      ELSE e
    END
    ORDER BY i
  )
  FROM jsonb_array_elements(v."overrides") WITH ORDINALITY AS t(e, i)
)
WHERE v."status" = 'entwurf'
  AND jsonb_typeof(v."overrides") = 'array'
  AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(v."overrides") AS x(e)
    WHERE x.e->>'art' = 'eingabe' AND x.e->>'key' = 'kartons'
  );
