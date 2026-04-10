import type { NextRequest } from "next/server";
import postgres from "postgres";
import { normalizeDatabaseUrl } from "@/db/normalize-database-url";

export const ADMIN_TARGET_DB_COOKIE = "admin_target_database_url";

/** Valid PostgreSQL identifier (unquoted, lower snake style). */
export function assertPgIdentifier(name: string, label: string): void {
  if (!/^[a-z][a-z0-9_]*$/i.test(name)) {
    throw new Error(`Invalid ${label}: use letters, numbers, underscore; must start with a letter`);
  }
}

export function quoteIdent(name: string): string {
  assertPgIdentifier(name, "identifier");
  return `"${name.replace(/"/g, '""')}"`;
}

const PG_TYPES = new Set([
  "text",
  "uuid",
  "boolean",
  "integer",
  "bigint",
  "numeric",
  "double precision",
  "timestamp",
  "timestamptz",
  "date",
  "jsonb",
]);

export function assertPgDataType(t: string): string {
  const normalized = t.toLowerCase().trim();
  if (!PG_TYPES.has(normalized)) {
    throw new Error(`Unsupported column type: ${t}`);
  }
  if (normalized === "timestamptz") return "timestamptz";
  return normalized;
}

export function getConfiguredDatabaseUrl(): string | undefined {
  const n = normalizeDatabaseUrl(process.env.DATABASE_URL);
  return n || undefined;
}

export function getTargetDatabaseUrl(req: NextRequest): string | undefined {
  const fromCookie = req.cookies.get(ADMIN_TARGET_DB_COOKIE)?.value;
  if (fromCookie) {
    const n = normalizeDatabaseUrl(fromCookie);
    if (n) return n;
  }
  const fromEnv = process.env.DATABASE_TARGET_URL;
  if (fromEnv) {
    const n = normalizeDatabaseUrl(fromEnv);
    if (n) return n;
  }
  return getConfiguredDatabaseUrl();
}

export function maskDatabaseUrl(url: string | undefined): {
  configured: boolean;
  host?: string;
  database?: string;
} {
  if (!url) return { configured: false };
  try {
    const u = new URL(url.replace(/^postgresql:/i, "https:"));
    return {
      configured: true,
      host: u.hostname,
      database: u.pathname.replace(/^\//, "") || undefined,
    };
  } catch {
    return { configured: true, host: "(unparseable URL)" };
  }
}

export function postgresSslOption(url: string): "require" | undefined {
  try {
    const host = new URL(url.replace(/^postgresql:/i, "https:")).hostname;
    if (host.endsWith("neon.tech") || host.endsWith("neon.build")) {
      return "require";
    }
  } catch {
    // ignore
  }
  return process.env.NODE_ENV === "production" ? "require" : undefined;
}

export async function withSqlClient<T>(
  connectionString: string,
  fn: (sql: postgres.Sql) => Promise<T>
): Promise<T> {
  const sql = postgres(connectionString, {
    max: 1,
    ssl: postgresSslOption(connectionString),
  });
  try {
    return await fn(sql);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

export async function testConnection(connectionString: string): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    await withSqlClient(connectionString, async (sql) => {
      await sql`SELECT 1 as ok`;
    });
    return { ok: true };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { ok: false, message };
  }
}
