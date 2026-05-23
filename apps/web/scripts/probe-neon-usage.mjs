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

console.log("=== Top tables by total size (incl. TOAST) ===");
const tables = await sql`
  SELECT
    relname AS table,
    pg_size_pretty(pg_total_relation_size(relid)) AS total_size,
    n_live_tup AS rows
  FROM pg_stat_user_tables
  ORDER BY pg_total_relation_size(relid) DESC
  LIMIT 12
`;
for (const t of tables) {
  console.log(`  ${t.table.padEnd(40)}  ${String(t.total_size).padStart(10)}  rows=${t.rows}`);
}

console.log("\n=== deal_documents by type ===");
const docs = await sql`
  SELECT document_type AS type, COUNT(*) AS n,
    pg_size_pretty(SUM(LENGTH(file_content))::bigint) AS base64_size,
    pg_size_pretty(SUM(file_size)::bigint) AS reported_size
  FROM deal_documents GROUP BY document_type
  ORDER BY SUM(LENGTH(file_content)) DESC NULLS LAST
`;
for (const d of docs) {
  console.log(`  ${String(d.type).padEnd(24)}  n=${String(d.n).padStart(3)}  base64=${d.base64_size}  reported=${d.reported_size}`);
}

console.log("\n=== inbox_message_attachments by kind ===");
const atts = await sql`
  SELECT
    CASE WHEN mime_type LIKE 'image/%' THEN 'image'
         WHEN mime_type LIKE 'video/%' THEN 'video'
         WHEN mime_type LIKE 'audio/%' THEN 'audio'
         WHEN mime_type = 'application/pdf' THEN 'pdf'
         ELSE 'other' END AS kind,
    COUNT(*) AS n,
    pg_size_pretty(SUM(LENGTH(file_content))::bigint) AS base64_size,
    pg_size_pretty(SUM(file_size)::bigint) AS reported_size
  FROM inbox_message_attachments GROUP BY 1
  ORDER BY SUM(LENGTH(file_content)) DESC NULLS LAST
`;
for (const a of atts) {
  console.log(`  ${a.kind.padEnd(8)}  n=${String(a.n).padStart(5)}  base64=${a.base64_size}  reported=${a.reported_size}`);
}

console.log("\n=== Largest inbox attachments ===");
const big = await sql`
  SELECT id, mime_type, file_size, created_at FROM inbox_message_attachments
  ORDER BY file_size DESC NULLS LAST LIMIT 5
`;
for (const b of big) {
  console.log(`  ${String(b.mime_type).padEnd(30)}  ${(Number(b.file_size)/1024/1024).toFixed(2)} MB  ${b.created_at?.toISOString?.() ?? b.created_at}`);
}

console.log("\n=== Employee photos ===");
const emp = await sql`
  SELECT COUNT(*) FILTER (WHERE photo_base64 IS NOT NULL) AS with_photo,
         COUNT(*) AS total,
         pg_size_pretty(SUM(LENGTH(photo_base64))::bigint) AS total_size
  FROM employees
`;
console.log(`  ${emp[0].with_photo}/${emp[0].total} have photos, total = ${emp[0].total_size}`);

console.log("\n=== Database size summary ===");
const dbsize = await sql`SELECT pg_size_pretty(pg_database_size(current_database())) AS db_size`;
console.log(`  total DB = ${dbsize[0].db_size}`);

await sql.end();
