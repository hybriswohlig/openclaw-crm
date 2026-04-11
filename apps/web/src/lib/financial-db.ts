import postgres from "postgres";
import { normalizeDatabaseUrl } from "@/db/normalize-database-url";

let sql: postgres.Sql | null = null;

function getFinancialSql(): postgres.Sql {
  if (!sql) {
    const raw = process.env.FINANCIAL_DATABASE_URL || process.env.DATABASE_URL;
    const connectionString = normalizeDatabaseUrl(raw);
    if (!connectionString) {
      throw new Error("FINANCIAL_DATABASE_URL (or DATABASE_URL fallback) is missing");
    }
    const host = (() => {
      try {
        return new URL(connectionString.replace(/^postgresql:/i, "https:")).hostname;
      } catch {
        return "";
      }
    })();
    const needsSsl = host.endsWith("neon.tech") || host.endsWith("neon.build");
    sql = postgres(connectionString, {
      max: 3,
      ssl: needsSsl || process.env.NODE_ENV === "production" ? "require" : undefined,
    });
  }
  return sql;
}

export async function queryFinancialDb<T extends postgres.Row>(
  fn: (sql: postgres.Sql) => Promise<postgres.RowList<T[]>>
): Promise<T[]> {
  const s = getFinancialSql();
  return [...(await fn(s))];
}
