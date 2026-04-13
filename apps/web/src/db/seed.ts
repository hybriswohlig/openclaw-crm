import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";
import { STANDARD_OBJECTS, DEAL_STAGES } from "@openclaw-crm/shared";

// Load env files the same way drizzle.config.ts does (repo root takes precedence via override).
const webDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(webDir, "../../../..");
for (const filePath of [
  path.join(repoRoot, ".env"),
  path.join(repoRoot, ".env.local"),
  path.join(webDir, ".env"),
  path.join(webDir, ".env.local"),
]) {
  loadEnv({ path: filePath, override: true, quiet: true });
}

async function seed() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is required");
  }

  const client = postgres(connectionString, { ssl: "require" });
  const db = drizzle(client, { schema });

  console.log("Seeding database...");

  // Check if a workspace already exists
  const existingWorkspaces = await db.select().from(schema.workspaces).limit(1);
  if (existingWorkspaces.length > 0) {
    console.log("Database already seeded, skipping...");
    await client.end();
    return;
  }

  // Create default workspace
  const [workspace] = await db
    .insert(schema.workspaces)
    .values({
      name: "Vi-Kang CRM",
      slug: "vi-kang",
      settings: {},
    })
    .returning();

  console.log(`Created workspace: ${workspace.name}`);

  // Seed standard objects (same logic as seedWorkspaceObjects in services/workspace.ts)
  for (const stdObj of STANDARD_OBJECTS) {
    const [object] = await db
      .insert(schema.objects)
      .values({
        workspaceId: workspace.id,
        slug: stdObj.slug,
        singularName: stdObj.singularName,
        pluralName: stdObj.pluralName,
        icon: stdObj.icon,
        isSystem: true,
      })
      .returning();

    console.log(`Created object: ${object.pluralName}`);

    for (let i = 0; i < stdObj.attributes.length; i++) {
      const attr = stdObj.attributes[i];
      const [attribute] = await db
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

      console.log(`  Created attribute: ${attribute.title} (${attribute.type})`);

      if (stdObj.slug === "deals" && attr.slug === "stage") {
        for (const stage of DEAL_STAGES) {
          await db.insert(schema.statuses).values({
            attributeId: attribute.id,
            title: stage.title,
            color: stage.color,
            sortOrder: stage.sortOrder,
            isActive: stage.isActive,
            celebrationEnabled: stage.celebrationEnabled,
          });
        }
        console.log(`  Created ${DEAL_STAGES.length} deal stages`);
      }
    }
  }

  // Seed the four built-in N&E regional teams
  const builtinTeams = [
    { key: "ne_germany", name: "N&E Germany" },
    { key: "ne_france", name: "N&E France" },
    { key: "ne_uk", name: "N&E UK" },
    { key: "ne_singapore", name: "N&E Singapore" },
  ];
  for (const team of builtinTeams) {
    await db.insert(schema.teams).values({ workspaceId: workspace.id, key: team.key, name: team.name });
    console.log(`Created team: ${team.name}`);
  }

  console.log("Seeding complete!");
  await client.end();
}

seed().catch((error) => {
  console.error("Seed failed:", error);
  process.exit(1);
});
