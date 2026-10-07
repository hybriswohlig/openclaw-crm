import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";
import { normalizeDatabaseUrl } from "./normalize-database-url";

type Schema = typeof schema;
type DrizzleDb = ReturnType<typeof drizzle<Schema>>;

let sql: postgres.Sql | null = null;
let instance: DrizzleDb | null = null;

function getDrizzle(): DrizzleDb {
  if (!instance) {
    const connectionString = normalizeDatabaseUrl(process.env.DATABASE_URL);
    if (!connectionString) {
      throw new Error("DATABASE_URL is missing or empty");
    }
    // Only set `ssl` in production: an explicit `ssl: undefined` makes
    // postgres.js ignore `sslmode=require` in the URL, so local dev against
    // Neon fails with "connection is insecure".
    sql = postgres(
      connectionString,
      process.env.NODE_ENV === "production" ? { ssl: "require" } : {},
    );
    instance = drizzle(sql, { schema });
  }
  return instance;
}

/**
 * Lazy proxy so importing `@/db` does not connect during `next build` / route collection.
 * The real client is created on first use (runtime).
 */
export const db = new Proxy({} as DrizzleDb, {
  get(_target, prop: string | symbol, receiver) {
    const d = getDrizzle();
    const value = Reflect.get(d as object, prop, receiver);
    return typeof value === "function" ? (value as (...a: unknown[]) => unknown).bind(d) : value;
  },
});
