/**
 * Prepare DATABASE_URL for `postgres` (postgres.js) on Vercel / Neon:
 * - Trim whitespace and strip accidental wrapping quotes from env UI paste
 * - Remove `channel_binding=require` — libpq-specific; postgres.js does not implement
 *   channel binding and Neon’s default string can cause SCRAM auth to fail with 28P01
 */
export function normalizeDatabaseUrl(raw: string | undefined): string {
  if (!raw) return "";
  let s = raw.trim();
  if (
    (s.startsWith('"') && s.endsWith('"')) ||
    (s.startsWith("'") && s.endsWith("'"))
  ) {
    s = s.slice(1, -1).trim();
  }
  try {
    const u = new URL(s.replace(/^postgres(ql)?:/i, "https:"));
    u.searchParams.delete("channel_binding");
    const auth =
      u.username || u.password
        ? `${encodeURIComponent(u.username)}${
            u.password ? `:${encodeURIComponent(u.password)}` : ""
          }@`
        : "";
    return `postgresql://${auth}${u.host}${u.pathname}${u.search}`;
  } catch {
    return s;
  }
}
