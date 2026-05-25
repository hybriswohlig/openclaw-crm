/**
 * One-off migration + seed for the offer-packages feature.
 *
 *   1. Adds quotations.selected_package_slug (text, nullable).
 *   2. Creates the offer_packages table.
 *   3. Seeds Kottke's three tiers (Basis / Komfort / Premium) + Einzeltransport
 *      against every operating-company record whose name matches /kottke/i.
 *      Does NOT seed Ceylan or any other firma — they get their own packages
 *      later via the admin UI.
 *
 * Idempotent. Safe to re-run. Verbose output.
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

// ─── 1. Schema changes ────────────────────────────────────────────────────────

console.log("Adding quotations.selected_package_slug ...");
await sql.unsafe(
  `ALTER TABLE quotations ADD COLUMN IF NOT EXISTS selected_package_slug text;`
);

console.log("Creating offer_packages table ...");
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
  SELECT r.id, r.object_id, rv.text_value AS name, o.workspace_id
  FROM records r
  JOIN objects o ON o.id = r.object_id
  JOIN attributes a ON a.object_id = o.id AND a.slug = 'name'
  JOIN record_values rv ON rv.record_id = r.id AND rv.attribute_id = a.id
  WHERE o.slug = 'operating_companies'
    AND rv.text_value ILIKE '%kottke%'
`;
if (kottkeOcs.length === 0) {
  console.log("No Kottke operating-company record found. Skipping seed.");
  console.log("Add packages manually via /settings/customer-portal once it exposes them.");
  await sql.end();
  process.exit(0);
}
for (const r of kottkeOcs) {
  console.log(`  Found Kottke OC: "${r.name}" (id=${r.id.slice(0, 8)})`);
}

// ─── 3. Package definitions ──────────────────────────────────────────────────

const KOTTKE_PACKAGES = [
  {
    slug: "basis",
    displayName: "Basis",
    shortDescription: "Schlanker Transport für kleine Wohnungen und WG-Wechsel.",
    targetSegment: "1 bis 2 Zimmer, Beiladung, WG-Wechsel",
    priceFromCents: 39000,
    priceFixedFlag: false,
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
    shortDescription: "Beliebteste Wahl. Der stressfreie Standardumzug.",
    targetSegment: "2 bis 4 Zimmer, Familien, Berufsumzüge",
    priceFromCents: 89000,
    priceFixedFlag: false,
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
    priceFromCents: 169000,
    priceFixedFlag: false,
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
  {
    slug: "einzeltransport",
    displayName: "Einzeltransport",
    shortDescription: "Festpreis für ein einzelnes Großstück.",
    targetSegment: "Klavier, Waschmaschine, Sofa, Einzelmöbel",
    priceFromCents: 14900,
    priceFixedFlag: true,
    includedItems: [
      "2 Helfer für ein Einzelstück",
      "Transporter inklusive 30 km",
      "Tragehilfe Treppe bis 3. OG",
      "Schutzdecken und Gurte",
    ],
    isRecommended: false,
    sortOrder: 40,
  },
];

// ─── 4. Upsert ────────────────────────────────────────────────────────────────

console.log("\nSeeding packages ...");
let inserted = 0;
let skipped = 0;

for (const oc of kottkeOcs) {
  for (const p of KOTTKE_PACKAGES) {
    const existing = await sql`
      SELECT id FROM offer_packages
      WHERE operating_company_record_id = ${oc.id} AND slug = ${p.slug}
      LIMIT 1
    `;
    if (existing.length > 0) {
      skipped++;
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
        ${p.priceFromCents}, ${p.priceFixedFlag},
        ${JSON.stringify(p.includedItems)}::jsonb,
        ${p.isRecommended}, ${p.sortOrder}
      )
    `;
    inserted++;
    console.log(`  + ${p.slug.padEnd(18)} → ${oc.name}`);
  }
}

console.log(`\nDone. Inserted ${inserted} package row(s), skipped ${skipped} existing.`);
await sql.end();
