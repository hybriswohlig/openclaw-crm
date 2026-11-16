# Crew-Portal: Rollout in Produktion

Stand: 2026-11-16, Branch `feat/crew-portal-api`. Vertrag: `apps/web/src/lib/crew/contract.ts`
(byteweise wie im Portal-Repo, `docs/API-CONTRACT.md` dort). Getestet auf dem Neon-Branch
`crew-portal-dev` (Kopie der Produktion vom 16.11.).

Reihenfolge einhalten: erst Datenbank, dann Attribut, dann Umgebung, dann Code. Die Migration ist
rein additiv; der alte Code läuft mit ihr unverändert weiter.

## 0. Sicherung

Neon-Konsole, Projekt `KottkeCRM`: vom Branch `production` einen Branch
`pre-crew-portal-<datum>` anlegen (Zeitpunkt jetzt). Kostet nichts und ist der Rückweg für den
Ernstfall.

## 1. Migration 0066 von Hand

Wie 0045 bis 0065: **nicht** `pnpm db:migrate`. Die Tabelle `drizzle.__drizzle_migrations` in
Produktion endet vor 0045; `drizzle-kit migrate` würde 0045 bis 0065 erneut ausführen.

```sh
# PROD_URL = Verbindungs-URL des Branches production (nicht in Dateien speichern)
psql "$PROD_URL" -X -1 -v ON_ERROR_STOP=1 -f apps/web/src/db/migrations/0066_crew_portal.sql
```

Die Datei ist idempotent (zweiter Lauf ändert nichts). Prüfen:

```sql
SELECT to_regclass('public.crew_links'), to_regclass('public.crew_job_responses');
SELECT table_name, column_name FROM information_schema.columns
WHERE (table_name = 'employees' AND column_name IN ('phone', 'phone_canonical', 'locale', 'photo_consent_at'))
   OR (table_name IN ('inbox_message_attachments', 'deal_internal_photos', 'job_media') AND column_name LIKE 'crew_freigegeben_%')
ORDER BY 1, 2;   -- 10 Zeilen
```

## 2. Nur das Attribut `crew_ausschreiben`

**Nicht** `pnpm db:sync-objects` laufen lassen: in Produktion fehlen 22 weitere Attribute aus
`standard-objects.ts` (review_*, brand, customer_locale, scope_change_* u. a.), der Sync würde
sie mit anlegen. Stattdessen nur dieses eine Attribut, idempotent:

```sql
INSERT INTO attributes (id, object_id, slug, title, type, config, is_system, is_required, is_unique, is_multiselect, sort_order)
SELECT gen_random_uuid()::text, o.id, 'crew_ausschreiben', 'Im Crew-Portal ausschreiben', 'checkbox', '{}'::jsonb,
       true, false, false, false, 5
FROM objects o
WHERE o.slug = 'auftraege'
  AND NOT EXISTS (SELECT 1 FROM attributes a WHERE a.object_id = o.id AND a.slug = 'crew_ausschreiben');

SELECT o.workspace_id, a.id FROM attributes a JOIN objects o ON o.id = a.object_id
WHERE o.slug = 'auftraege' AND a.slug = 'crew_ausschreiben';   -- eine Zeile je Workspace
```

Kein Wert heißt „ausschreiben“. Nur ein ausdrückliches `false` am Auftrag hält einen Job aus dem
Portal (eine Oberfläche dafür gibt es noch nicht; in der alten Auftrag-Ansicht erscheint das Feld
als Haken).

## 3. Umgebung

Vercel, Projekt des CRM, Umgebung Production:

| Variable | Wert |
|---|---|
| `CREW_API_SECRET` | `openssl rand -base64 48` (mindestens 32 Bytes). **Gleicher Wert** im Portal-Projekt. Nie im Browser, nie in Git. |
| `CREW_PORTAL_URL` | Basis-URL des Portals ohne Schrägstrich am Ende, z. B. `https://team.kottke-umzuege.de`. Daraus wird der Link `${CREW_PORTAL_URL}/l/<token>`. |

Ohne `CREW_API_SECRET` (oder mit weniger als 32 Bytes) antwortet die Crew-API immer 401. Das ist
gewollt und zugleich der Notschalter (siehe Rückweg).

## 4. Code

Branch mergen, deployen. Neue Abhängigkeit: `sharp` 0.34.5 (dieselbe Version, die Next mitbringt;
Fotos werden für die Crew immer neu kodiert, ohne EXIF/GPS, max. 1000 px, WebP).

Rauchtest vom eigenen Rechner (Werte aus der Umgebung, nicht in die Shell-History tippen):

```sh
curl -s -o /dev/null -w "%{http_code}\n" https://<crm>/api/crew/v1/me                 # 401
curl -s -w " %{http_code}\n" -H "X-Crew-Secret: $CREW_API_SECRET" \
     -H "X-Crew-Token: $TOKEN" https://<crm>/api/crew/v1/jobs | tail -c 120            # 200
```

## 5. Erste Links

Neue Oberfläche, **Mitarbeiter**, Person wählen:

1. Telefon eintragen (0151 … wird zu +49 …), Sprache wählen, „Speichern“.
2. Karte **Crew-Link**: „Link anlegen“, „Kopieren“, per WhatsApp an die Person.
3. Verloren oder weitergegeben: „Neuer Link …“ (alter geht sofort nicht mehr) oder „Sperren …“.
   „Zuletzt geöffnet“ zeigt, ob der Link benutzt wird.

Nur aktive Personen bekommen einen Link. Fotos für Jobkarten: Akte, Ansicht **Fotos**, je Bild
„Für Crew freigeben“ (nur Innen- und Möbelfotos; JPEG, PNG, WebP, GIF; kein HEIC).

Anfragen aus dem Portal erscheinen im Einsatz-Dialog oben („Anfragen aus dem Crew-Portal“).
„Ins Team“ nimmt die Person in die Auswahl, gespeichert wird mit „Team bestätigen“.

## 6. Rückweg

**Sofort, ohne Deploy:** `CREW_API_SECRET` in Vercel entfernen und neu deployen bzw. Funktion neu
starten → jede Crew-Anfrage 401. Alle Links einzeln sperren geht auch:

```sql
UPDATE crew_links SET revoked_at = now() WHERE revoked_at IS NULL;
```

**Code:** den Merge zurücknehmen. Die Migration darf stehen bleiben (additiv).

**Datenbank ganz zurück** (löscht Links und Antworten endgültig; vorher Sicherung aus Schritt 0):

```sql
BEGIN;
DROP TABLE IF EXISTS crew_job_responses;
DROP TABLE IF EXISTS crew_links;
DROP INDEX IF EXISTS inbox_attachments_crew_frei_idx;
DROP INDEX IF EXISTS deal_internal_photos_crew_frei_idx;
DROP INDEX IF EXISTS job_media_crew_frei_idx;
ALTER TABLE inbox_message_attachments DROP COLUMN IF EXISTS crew_freigegeben_at, DROP COLUMN IF EXISTS crew_freigegeben_by;
ALTER TABLE deal_internal_photos DROP COLUMN IF EXISTS crew_freigegeben_at, DROP COLUMN IF EXISTS crew_freigegeben_by;
ALTER TABLE job_media DROP COLUMN IF EXISTS crew_freigegeben_at, DROP COLUMN IF EXISTS crew_freigegeben_by;
DROP INDEX IF EXISTS employees_phone_canonical_uq;
ALTER TABLE employees DROP CONSTRAINT IF EXISTS employees_locale_check;
ALTER TABLE employees DROP CONSTRAINT IF EXISTS employees_phone_canonical_format;
ALTER TABLE employees DROP COLUMN IF EXISTS phone, DROP COLUMN IF EXISTS phone_canonical,
  DROP COLUMN IF EXISTS locale, DROP COLUMN IF EXISTS photo_consent_at;
DELETE FROM attributes a USING objects o
WHERE a.object_id = o.id AND o.slug = 'auftraege' AND a.slug = 'crew_ausschreiben';   -- Werte gehen per Kaskade mit
COMMIT;
```

Erst den Code zurücknehmen, dann die Datenbank: der neue Code liest die neuen Spalten.
