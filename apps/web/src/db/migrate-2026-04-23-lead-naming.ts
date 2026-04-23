import "dotenv/config";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { eq, and, inArray } from "drizzle-orm";
import * as schema from "./schema";
import { normalizeDatabaseUrl } from "./normalize-database-url";
import { computeLeadName, shouldAutoRename } from "../services/lead-name";

/**
 * Pull a real customer name out of a previously auto-generated title. Handles
 * our own "Name — ..." format (strips the part after the em-dash) AND the old
 * IS24 style "Umzug A → B (Name)" (pulls the parenthetical).
 */
function extractCustomerName(raw: string | null): string | null {
  if (!raw) return null;
  let s = raw.trim();
  if (!s) return null;

  // Old IS24 shape: "Umzug X → Y (Name)"
  const m1 = s.match(/^Umzug\s.+→.+\(([^)]+)\)(?:\s+—\s.+)?$/i);
  if (m1) return m1[1].trim();

  // Previously-computed canonical shape: "Name — ..."
  const emDash = s.indexOf(" — ");
  if (emDash > 0) s = s.slice(0, emDash).trim();

  return s || null;
}

/**
 * One-shot: apply the canonical Lead-name convention to existing leads.
 *
 *   "Customer — FromCity → ToCity"   (best)
 *   "Customer — DD.MM.YYYY"          (fallback: date)
 *   "Customer"                       (fallback: name only)
 *   untouched                        (if the current name was user-typed)
 */
async function main() {
  const connectionString = normalizeDatabaseUrl(process.env.DATABASE_URL);
  if (!connectionString) throw new Error("DATABASE_URL is required");
  const client = postgres(connectionString);
  const db = drizzle(client, { schema });

  // Find all `deals` objects (one per workspace)
  const dealObjs = await db
    .select({ id: schema.objects.id, workspaceId: schema.objects.workspaceId })
    .from(schema.objects)
    .where(eq(schema.objects.slug, "deals"));

  let renamed = 0;
  let skipped = 0;
  let unchanged = 0;

  for (const dealObj of dealObjs) {
    const attrRows = await db
      .select()
      .from(schema.attributes)
      .where(eq(schema.attributes.objectId, dealObj.id));
    const bySlug = new Map(attrRows.map((a) => [a.slug, a]));

    const nameAttr = bySlug.get("name");
    const moveDateAttr = bySlug.get("move_date");
    const fromAttr = bySlug.get("move_from_address");
    const toAttr = bySlug.get("move_to_address");
    if (!nameAttr) continue;

    const dealRecords = await db
      .select({ id: schema.records.id })
      .from(schema.records)
      .where(eq(schema.records.objectId, dealObj.id));

    if (dealRecords.length === 0) continue;

    const dealIds = dealRecords.map((r) => r.id);
    const interestedAttrIds = [nameAttr.id, moveDateAttr?.id, fromAttr?.id, toAttr?.id].filter(
      (x): x is string => !!x
    );

    const vals = await db
      .select()
      .from(schema.recordValues)
      .where(
        and(
          inArray(schema.recordValues.recordId, dealIds),
          inArray(schema.recordValues.attributeId, interestedAttrIds)
        )
      );

    const valByRecord = new Map<string, Map<string, typeof vals[number]>>();
    for (const v of vals) {
      let m = valByRecord.get(v.recordId);
      if (!m) {
        m = new Map();
        valByRecord.set(v.recordId, m);
      }
      m.set(v.attributeId, v);
    }

    for (const rec of dealRecords) {
      const m = valByRecord.get(rec.id);
      const currentName = nameAttr ? m?.get(nameAttr.id)?.textValue ?? null : null;

      if (!shouldAutoRename(currentName)) {
        skipped++;
        continue;
      }

      const moveDate = moveDateAttr ? m?.get(moveDateAttr.id)?.dateValue ?? null : null;
      const fromAddr = fromAttr ? m?.get(fromAttr.id)?.jsonValue ?? null : null;
      const toAddr = toAttr ? m?.get(toAttr.id)?.jsonValue ?? null : null;

      const customerName = extractCustomerName(currentName);
      const nextName = computeLeadName({
        customerName,
        moveDate,
        fromAddress: fromAddr,
        toAddress: toAddr,
      });

      if (!nextName || nextName === currentName) {
        unchanged++;
        continue;
      }

      // Upsert the name value.
      const existingName = m?.get(nameAttr.id);
      if (existingName) {
        await db
          .update(schema.recordValues)
          .set({ textValue: nextName })
          .where(eq(schema.recordValues.id, existingName.id));
      } else {
        await db.insert(schema.recordValues).values({
          recordId: rec.id,
          attributeId: nameAttr.id,
          textValue: nextName,
          sortOrder: 0,
        });
      }
      console.log(`  ${currentName ?? "(leer)"}  →  ${nextName}`);
      renamed++;
    }
  }

  console.log(`\n✓ Done. Renamed: ${renamed}, unchanged: ${unchanged}, user-typed (skipped): ${skipped}`);
  await client.end();
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
