import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";
import { normalizeDatabaseUrl } from "./normalize-database-url";

const connectionString = normalizeDatabaseUrl(process.env.DATABASE_URL);
if (!connectionString) {
  throw new Error("DATABASE_URL is missing or empty");
}

const client = postgres(connectionString, {
  ssl: process.env.NODE_ENV === "production" ? "require" : undefined,
});
export const db = drizzle(client, { schema });
