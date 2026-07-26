-- Customer-chosen portal language ('de' | 'en').
--
-- Nullable with no default: null means "the customer never touched the
-- language toggle", which is what every existing row is. The portal then
-- falls back to the browser's Accept-Language and finally to German, so
-- nothing changes for current links.
--
-- App-enforced values: 'de' | 'en' (see PORTAL_LOCALES in
-- packages/customer-portal-core/src/i18n/locale.ts).
ALTER TABLE "customer_status_links"
  ADD COLUMN IF NOT EXISTS "preferred_locale" text;
