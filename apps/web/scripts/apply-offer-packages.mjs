/**
 * Sync the canonical Kottke packages with what the website advertises.
 *
 *   1. Adds quotations.selected_package_slug (text, nullable) if missing.
 *   2. Creates the offer_packages table if missing.
 *   3. Aligns Kottke's packages to exactly the three tiers from
 *      kottke-umzuege.de (Basis / Komfort / Premium):
 *        - Upserts the three canonical rows (no global price; price is set
 *          per quotation because every move is different).
 *        - Nullifies price_from_cents on any pre-existing rows so the
 *          customer portal stops showing "ab X €" labels.
 *        - Deletes any legacy packages (e.g. an earlier "einzeltransport"
 *          row that was seeded by mistake).
 *
 * Idempotent. Safe to re-run. Only touches OCs whose name matches /kottke/i.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import postgres from "postgres";

const here = path.dirname(fileURLToPath(import.meta.url));
const webDir = path.resolve(here, "..");
const repoRoot = path.resolve(webDir, "../..");
for (const p of [
  path.join(repoRoot, ".env.local"),
  path.join(repoRoot, ".env"),
  path.join(webDir, ".env.local"),
  path.join(webDir, ".env"),
]) loadEnv({ path: p, override: false, quiet: true });

const url = (process.env.DATABASE_URL || "").replace(/&channel_binding=require/, "");
if (!url) {
  console.error("DATABASE_URL missing");
  process.exit(1);
}
const sql = postgres(url, { ssl: "require" });

// ─── 1. Schema (no-op if already applied) ─────────────────────────────────────

console.log("Ensuring quotations.selected_package_slug exists ...");
await sql.unsafe(
  `ALTER TABLE quotations ADD COLUMN IF NOT EXISTS selected_package_slug text;`
);

console.log("Ensuring offer_packages table exists ...");
await sql.unsafe(`
  CREATE TABLE IF NOT EXISTS offer_packages (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    operating_company_record_id text NOT NULL REFERENCES records(id) ON DELETE CASCADE,
    slug text NOT NULL,
    display_name text NOT NULL,
    short_description text,
    target_segment text,
    price_from_cents integer,
    price_fixed_flag boolean NOT NULL DEFAULT false,
    included_items jsonb NOT NULL DEFAULT '[]'::jsonb,
    is_recommended boolean NOT NULL DEFAULT false,
    sort_order integer NOT NULL DEFAULT 0,
    active boolean NOT NULL DEFAULT true,
    created_at timestamp NOT NULL DEFAULT now(),
    updated_at timestamp NOT NULL DEFAULT now()
  );
`);
await sql.unsafe(`
  CREATE UNIQUE INDEX IF NOT EXISTS offer_packages_oc_slug_idx
    ON offer_packages (operating_company_record_id, slug);
`);
await sql.unsafe(`
  CREATE INDEX IF NOT EXISTS offer_packages_workspace_idx
    ON offer_packages (workspace_id);
`);
await sql.unsafe(`
  CREATE INDEX IF NOT EXISTS offer_packages_oc_idx
    ON offer_packages (operating_company_record_id);
`);

// ─── 2. Find Kottke operating-company records ────────────────────────────────

console.log("\nLooking up Kottke operating companies ...");
const kottkeOcs = await sql`
  SELECT r.id, rv.text_value AS name, o.workspace_id
  FROM records r
  JOIN objects o ON o.id = r.object_id
  JOIN attributes a ON a.object_id = o.id AND a.slug = 'name'
  JOIN record_values rv ON rv.record_id = r.id AND rv.attribute_id = a.id
  WHERE o.slug = 'operating_companies'
    AND rv.text_value ILIKE '%kottke%'
`;
if (kottkeOcs.length === 0) {
  console.log("No Kottke operating-company record found. Done.");
  await sql.end();
  process.exit(0);
}
for (const r of kottkeOcs) {
  console.log(`  Found Kottke OC: "${r.name}" (id=${r.id.slice(0, 8)})`);
}

// ─── 3. Canonical Kottke packages (website 1:1) ──────────────────────────────

const KOTTKE_PACKAGES = [
  {
    slug: "basis",
    displayName: "Basis",
    shortDescription: "Selbermacher. Schlanker Transport für kleine Wohnungen und WG-Wechsel.",
    targetSegment: "1 bis 2 Zimmer, Beiladung, WG-Wechsel",
    includedItems: [
      "1 Helfer plus 3,5-Tonner Transporter",
      "Beladen, Transport, Entladen",
      "Umzugsdecken und Spanngurte",
      "Persönlicher Ansprechpartner",
    ],
    isRecommended: false,
    sortOrder: 10,
  },
  {
    slug: "komfort",
    displayName: "Komfort",
    shortDescription: "Stressfrei. Beliebteste Wahl. Der entspannte Standardumzug.",
    targetSegment: "2 bis 4 Zimmer, Familien, Berufsumzüge",
    includedItems: [
      "2 bis 3 Helfer plus Transporter",
      "Möbeldemontage und Montage",
      "Sichere Beladung mit Schutzhüllen",
      "Routenplanung und Logistik",
      "Kartonageberatung",
    ],
    isRecommended: true,
    sortOrder: 20,
  },
  {
    slug: "premium",
    displayName: "Premium",
    shortDescription: "Schlüsselfertig. Sie packen keinen Karton an.",
    targetSegment: "Häuser, Senioren, Haushaltsauflösungen",
    includedItems: [
      "Alle Leistungen aus Komfort",
      "Einpackservice vor Ort",
      "Entrümpelung und Entsorgung",
      "Halteverbotszone-Koordination",
      "Besenreine Übergabe",
    ],
    isRecommended: false,
    sortOrder: 30,
  },
];

const CANONICAL_SLUGS = new Set(KOTTKE_PACKAGES.map((p) => p.slug));

// ─── 4. Reconcile ─────────────────────────────────────────────────────────────

console.log("\nReconciling packages ...");
let inserted = 0;
let updated = 0;
let deleted = 0;

for (const oc of kottkeOcs) {
  // Drop any non-canonical legacy rows (e.g. older "einzeltransport").
  const dropped = await sql`
    DELETE FROM offer_packages
    WHERE operating_company_record_id = ${oc.id}
      AND slug NOT IN ${sql(KOTTKE_PACKAGES.map((p) => p.slug))}
    RETURNING slug
  `;
  for (const d of dropped) {
    console.log(`  - removed legacy slug "${d.slug}" from ${oc.name}`);
    deleted++;
  }

  for (const p of KOTTKE_PACKAGES) {
    const existing = await sql`
      SELECT id FROM offer_packages
      WHERE operating_company_record_id = ${oc.id} AND slug = ${p.slug}
      LIMIT 1
    `;
    if (existing.length > 0) {
      // Update text fields, blanking the price so the customer portal stops
      // surfacing a global "from" number.
      await sql`
        UPDATE offer_packages SET
          display_name = ${p.displayName},
          short_description = ${p.shortDescription},
          target_segment = ${p.targetSegment},
          price_from_cents = NULL,
          price_fixed_flag = false,
          included_items = ${JSON.stringify(p.includedItems)}::jsonb,
          is_recommended = ${p.isRecommended},
          sort_order = ${p.sortOrder},
          active = true,
          updated_at = now()
        WHERE id = ${existing[0].id}
      `;
      updated++;
      console.log(`  ~ updated  ${p.slug.padEnd(10)} → ${oc.name}`);
      continue;
    }
    await sql`
      INSERT INTO offer_packages (
        workspace_id, operating_company_record_id,
        slug, display_name, short_description, target_segment,
        price_from_cents, price_fixed_flag,
        included_items, is_recommended, sort_order
      ) VALUES (
        ${oc.workspace_id}, ${oc.id},
        ${p.slug}, ${p.displayName}, ${p.shortDescription}, ${p.targetSegment},
        NULL, false,
        ${JSON.stringify(p.includedItems)}::jsonb,
        ${p.isRecommended}, ${p.sortOrder}
      )
    `;
    inserted++;
    console.log(`  + inserted ${p.slug.padEnd(10)} → ${oc.name}`);
  }
}

// Belt and suspenders: null any stale prices that might exist on Kottke rows
// where the script above somehow missed them.
await sql.unsafe(`
  UPDATE offer_packages
  SET price_from_cents = NULL, price_fixed_flag = false
  WHERE operating_company_record_id IN (
    SELECT r.id FROM records r
    JOIN objects o ON o.id = r.object_id
    JOIN attributes a ON a.object_id = o.id AND a.slug = 'name'
    JOIN record_values rv ON rv.record_id = r.id AND rv.attribute_id = a.id
    WHERE o.slug = 'operating_companies' AND rv.text_value ILIKE '%kottke%'
  )
  AND (price_from_cents IS NOT NULL OR price_fixed_flag = true);
`);

void CANONICAL_SLUGS;
console.log(`\nDone. inserted=${inserted}  updated=${updated}  deleted=${deleted}.`);
await sql.end();
