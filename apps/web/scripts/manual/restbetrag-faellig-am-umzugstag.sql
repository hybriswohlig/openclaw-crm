-- Einmalige Datenkorrektur, kein Migrationsschritt.
-- Nicht von der Anwendung ausführen. Nicht von einem Agenten ausführen.
-- Setzt gespeicherte Firmenregeln zurück, die ein späteres Zahlungsziel
-- beschreiben würden (N Tage nach Umzug oder Rechnungstag). Die Fälligkeit
-- rechnet die Anwendung ohnehin ohne diese Tage: Restbetrag am Umzugstag,
-- oder am Rechnungstag, wenn die Rechnung am oder nach dem Umzug liegt.
-- Erinnerungstage bleiben unangetastet.

UPDATE company_settings
SET zahlungsziel_basis = 'umzugstag',
    zahlungsziel_tage = 0,
    updated_at = now()
WHERE zahlungsziel_tage <> 0
   OR zahlungsziel_basis <> 'umzugstag';
