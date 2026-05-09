import "dotenv/config";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { and, eq, isNull, sql } from "drizzle-orm";
import * as schema from "./schema";
import { normalizeDatabaseUrl } from "./normalize-database-url";

// One-off backfill for KOT-614 / KOT-603. Per CEO default 3 on the post-move
// reviews engine: existing customers (booked before the booking-form consent
// checkbox lands in [KOT-620]) must default to do_not_contact_review = true.
// They are excluded from sends until a separate explicit opt-in campaign
// reactivates them.
//
// Idempotent: only inserts a record_values row if one doesn't already exist
// for the (record, do_not_contact_review attribute) pair.
//
// Run order:
//   1) drizzle-kit migrate            (creates review_events, review_tokens,
//                                      adds the timestamp_value index)
//   2) pnpm db:sync-objects           (seeds the new deal attributes incl.
//                                      do_not_contact_review and statuses)
//   3) tsx src/db/migrate-2026-05-09-reviews-engine-backfill.ts
//                                     (this script — flips existing deals)

async function main() {
  const connectionString = normalizeDatabaseUrl(process.env.DATABASE_URL);
  if (!connectionString) throw new Error("DATABASE_URL is required");

  const client = postgres(connectionString);
  const db = drizzle(client, { schema });

  let totalDeals = 0;
  let backfilled = 0;
  let alreadySet = 0;

  const workspaceRows = await db
    .select({ id: schema.workspaces.id, name: schema.workspaces.name })
    .from(schema.workspaces);

  for (const ws of workspaceRows) {
    console.log(`\n▸ Workspace ${ws.name} (${ws.id.slice(0, 8)})`);

    // 1) Find the deals object + the do_not_contact_review attribute on it.
    const [dealsObject] = await db
      .select()
      .from(schema.objects)
      .where(and(eq(schema.objects.workspaceId, ws.id), eq(schema.objects.slug, "deals")))
      .limit(1);
    if (!dealsObject) {
      console.log("  (no deals object — skipping)");
      continue;
    }

    const [dncAttr] = await db
      .select()
      .from(schema.attributes)
      .where(and(eq(schema.attributes.objectId, dealsObject.id), eq(schema.attributes.slug, "do_not_contact_review")))
      .limit(1);
    if (!dncAttr) {
      console.log("  (do_not_contact_review attribute missing — run pnpm db:sync-objects first)");
      continue;
    }

    // 2) For every existing deal record, ensure a do_not_contact_review = true row.
    //    LEFT JOIN: pick records that don't yet have a record_values row for this attribute.
    const dealsWithoutDnc = await db.execute(sql`
      SELECT r.id AS record_id
      FROM records r
      LEFT JOIN record_values rv
        ON rv.record_id = r.id AND rv.attribute_id = ${dncAttr.id}
      WHERE r.object_id = ${dealsObject.id}
        AND rv.id IS NULL
    `);

    const rows = (dealsWithoutDnc as unknown as { record_id: string }[]) ?? [];
    totalDeals += rows.length;

    for (const row of rows) {
      await db.insert(schema.recordValues).values({
        recordId: row.record_id,
        attributeId: dncAttr.id,
        booleanValue: true,
      });
      backfilled++;
    }

    // 3) Count rows that already had the attribute set (for visibility).
    const alreadyCountResult = await db.execute(sql`
      SELECT COUNT(*)::int AS n
      FROM record_values rv
      JOIN records r ON r.id = rv.record_id
      WHERE r.object_id = ${dealsObject.id}
        AND rv.attribute_id = ${dncAttr.id}
        AND rv.boolean_value = true
    `);
    const already = ((alreadyCountResult as unknown as { n: number }[])[0]?.n ?? 0) - rows.length;
    alreadySet += Math.max(0, already);

    console.log(`  + ${rows.length} deal(s) flipped to do_not_contact_review=true`);
  }

  console.log(
    `\n✓ Backfill complete. Scanned ${totalDeals} deal(s); inserted ${backfilled} row(s); ${alreadySet} already had the value set.`
  );
  await client.end();
}

main().catch((err) => {
  console.error("Backfill failed:", err);
  process.exit(1);
});
