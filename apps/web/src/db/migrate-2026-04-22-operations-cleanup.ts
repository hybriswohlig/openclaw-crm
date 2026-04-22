import "dotenv/config";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { and, eq, inArray } from "drizzle-orm";
import * as schema from "./schema";
import { normalizeDatabaseUrl } from "./normalize-database-url";

/**
 * One-shot cleanup for the Operations / Auftrag rework on 2026-04-22.
 *
 * - Drops the `assigned_employees` attribute from the `auftraege` object
 *   (mitarbeiter assignment now lives only in the `dealEmployees` table).
 * - Renames `truck_size` → `transporter` and replaces its options with the
 *   actual vehicle types we use day-to-day.
 *
 * Safe to re-run — every step is gated on existence checks.
 */
async function main() {
  const connectionString = normalizeDatabaseUrl(process.env.DATABASE_URL);
  if (!connectionString) throw new Error("DATABASE_URL is required");
  const client = postgres(connectionString);
  const db = drizzle(client, { schema });

  const auftrageObjs = await db
    .select({ id: schema.objects.id, workspaceId: schema.objects.workspaceId })
    .from(schema.objects)
    .where(eq(schema.objects.slug, "auftraege"));

  if (auftrageObjs.length === 0) {
    console.log("No `auftraege` object found — nothing to do.");
    await client.end();
    return;
  }

  for (const obj of auftrageObjs) {
    console.log(`\n▸ workspace ${obj.workspaceId.slice(0, 8)} / object ${obj.id.slice(0, 8)}`);

    // 1) Drop assigned_employees (cascade removes its values).
    const assignedAttr = await db
      .select()
      .from(schema.attributes)
      .where(and(eq(schema.attributes.objectId, obj.id), eq(schema.attributes.slug, "assigned_employees")))
      .limit(1);

    if (assignedAttr.length > 0) {
      await db.delete(schema.attributes).where(eq(schema.attributes.id, assignedAttr[0].id));
      console.log("  − dropped attribute: assigned_employees");
    }

    // 2) Rename truck_size → transporter (preserve attribute id so any record_values survive).
    const truckAttr = await db
      .select()
      .from(schema.attributes)
      .where(and(eq(schema.attributes.objectId, obj.id), eq(schema.attributes.slug, "truck_size")))
      .limit(1);

    let transporterAttrId: string | null = null;
    if (truckAttr.length > 0) {
      await db
        .update(schema.attributes)
        .set({ slug: "transporter", title: "Transporter" })
        .where(eq(schema.attributes.id, truckAttr[0].id));
      transporterAttrId = truckAttr[0].id;
      console.log("  ↻ renamed truck_size → transporter");
    } else {
      const existingTransporter = await db
        .select()
        .from(schema.attributes)
        .where(and(eq(schema.attributes.objectId, obj.id), eq(schema.attributes.slug, "transporter")))
        .limit(1);
      transporterAttrId = existingTransporter[0]?.id ?? null;
    }

    if (!transporterAttrId) {
      console.log("  (no transporter attribute yet — sync-objects will create it)");
      continue;
    }

    // 3) Replace its select options with the new vehicle list.
    //    We keep options whose title matches one in the new list; the rest are dropped.
    //    record_values that referenced removed option IDs are also cleared so the UI
    //    doesn't render stale chips.
    const newOptions = [
      { title: "Auto", color: "#22c55e" },
      { title: "Mercedes Sprinter kurz", color: "#0ea5e9" },
      { title: "Mercedes Sprinter lang", color: "#6366f1" },
      { title: "Peugeot Boxer 3,5 t", color: "#ea580c" },
    ];

    const existingOpts = await db
      .select()
      .from(schema.selectOptions)
      .where(eq(schema.selectOptions.attributeId, transporterAttrId));

    const keepTitles = new Set(newOptions.map((o) => o.title.toLowerCase()));
    const obsoleteOptIds = existingOpts
      .filter((o) => !keepTitles.has(o.title.toLowerCase()))
      .map((o) => o.id);

    if (obsoleteOptIds.length > 0) {
      // Clear any record_values pointing at obsolete option IDs.
      await db
        .delete(schema.recordValues)
        .where(
          and(
            eq(schema.recordValues.attributeId, transporterAttrId),
            inArray(schema.recordValues.textValue, obsoleteOptIds)
          )
        );
      await db.delete(schema.selectOptions).where(inArray(schema.selectOptions.id, obsoleteOptIds));
      console.log(`  − dropped ${obsoleteOptIds.length} obsolete transporter option(s)`);
    }

    // 4) Insert any new options that don't already exist.
    const existingTitlesLower = new Set(existingOpts.map((o) => o.title.toLowerCase()));
    let insertedSort = existingOpts.length;
    for (const opt of newOptions) {
      if (existingTitlesLower.has(opt.title.toLowerCase())) continue;
      await db.insert(schema.selectOptions).values({
        attributeId: transporterAttrId,
        title: opt.title,
        color: opt.color,
        sortOrder: insertedSort++,
      });
      console.log(`  + transporter option: ${opt.title}`);
    }
  }

  console.log("\n✓ Cleanup complete.");
  await client.end();
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
