import "dotenv/config";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { and, eq } from "drizzle-orm";
import * as schema from "./schema";
import { STANDARD_OBJECTS, DEAL_STAGES } from "@openclaw-crm/shared";
import { normalizeDatabaseUrl } from "./normalize-database-url";

/**
 * Idempotent sync of STANDARD_OBJECTS into every workspace. Safe to run
 * multiple times — inserts only objects/attributes/options that don't
 * yet exist (matched by slug). Never deletes or renames anything.
 */
async function syncStandardObjects() {
  const connectionString = normalizeDatabaseUrl(process.env.DATABASE_URL);
  if (!connectionString) throw new Error("DATABASE_URL is required");

  const client = postgres(connectionString);
  const db = drizzle(client, { schema });

  const workspaceRows = await db.select({ id: schema.workspaces.id, name: schema.workspaces.name }).from(schema.workspaces);
  if (workspaceRows.length === 0) {
    console.log("No workspaces found — nothing to sync. Run `pnpm db:seed` first.");
    await client.end();
    return;
  }

  let objectsAdded = 0;
  let attributesAdded = 0;
  let optionsAdded = 0;
  let stagesAdded = 0;

  for (const ws of workspaceRows) {
    console.log(`\n▸ Workspace ${ws.name} (${ws.id.slice(0, 8)})`);

    for (const stdObj of STANDARD_OBJECTS) {
      // 1) Upsert the object by (workspaceId, slug)
      let [object] = await db
        .select()
        .from(schema.objects)
        .where(and(eq(schema.objects.workspaceId, ws.id), eq(schema.objects.slug, stdObj.slug)))
        .limit(1);

      if (!object) {
        [object] = await db
          .insert(schema.objects)
          .values({
            workspaceId: ws.id,
            slug: stdObj.slug,
            singularName: stdObj.singularName,
            pluralName: stdObj.pluralName,
            icon: stdObj.icon,
            isSystem: true,
          })
          .returning();
        console.log(`  + object: ${stdObj.pluralName}`);
        objectsAdded++;
      }

      // 2) Existing attribute slugs for this object
      const existingAttrs = await db
        .select()
        .from(schema.attributes)
        .where(eq(schema.attributes.objectId, object.id));
      const existingSlugs = new Set(existingAttrs.map((a) => a.slug));

      // 3) Insert missing attributes (keep sortOrder consistent with STANDARD_OBJECTS ordering)
      for (let i = 0; i < stdObj.attributes.length; i++) {
        const attr = stdObj.attributes[i];

        let attribute = existingAttrs.find((a) => a.slug === attr.slug) ?? null;

        if (!attribute) {
          [attribute] = await db
            .insert(schema.attributes)
            .values({
              objectId: object.id,
              slug: attr.slug,
              title: attr.title,
              type: attr.type,
              config: attr.config || {},
              isSystem: attr.isSystem,
              isRequired: attr.isRequired,
              isUnique: attr.isUnique,
              isMultiselect: attr.isMultiselect,
              sortOrder: i,
            })
            .returning();
          console.log(`    + attr: ${attr.title} (${attr.type})`);
          existingSlugs.add(attr.slug);
          attributesAdded++;
        }

        // 4) Seed select options if missing (by title match)
        if (attr.type === "select" && attr.selectOptions?.length) {
          const existingOpts = await db
            .select()
            .from(schema.selectOptions)
            .where(eq(schema.selectOptions.attributeId, attribute.id));
          const existingTitles = new Set(existingOpts.map((o) => o.title.toLowerCase()));
          for (let j = 0; j < attr.selectOptions.length; j++) {
            const opt = attr.selectOptions[j]!;
            if (existingTitles.has(opt.title.toLowerCase())) continue;
            await db.insert(schema.selectOptions).values({
              attributeId: attribute.id,
              title: opt.title,
              color: opt.color ?? "#6366f1",
              sortOrder: (existingOpts.length || 0) + j,
            });
            console.log(`      + option: ${opt.title}`);
            optionsAdded++;
          }
        }

        // 5) Seed deal stages (only for the stage status attribute on deals)
        if (stdObj.slug === "deals" && attr.slug === "stage") {
          const existingStages = await db
            .select()
            .from(schema.statuses)
            .where(eq(schema.statuses.attributeId, attribute.id));
          const existingStageTitles = new Set(existingStages.map((s) => s.title.toLowerCase()));
          for (const stage of DEAL_STAGES) {
            if (existingStageTitles.has(stage.title.toLowerCase())) continue;
            await db.insert(schema.statuses).values({
              attributeId: attribute.id,
              title: stage.title,
              color: stage.color,
              sortOrder: stage.sortOrder,
              isActive: stage.isActive,
              celebrationEnabled: stage.celebrationEnabled,
            });
            console.log(`      + stage: ${stage.title}`);
            stagesAdded++;
          }
        }
      }
    }
  }

  console.log(
    `\n✓ Sync complete. Added: ${objectsAdded} object(s), ${attributesAdded} attr(s), ${optionsAdded} option(s), ${stagesAdded} stage(s).`
  );
  await client.end();
}

syncStandardObjects().catch((err) => {
  console.error("Sync failed:", err);
  process.exit(1);
});
