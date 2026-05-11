import { db } from "@/db";
import { users, workspaceMembers } from "@/db/schema";
import { and, eq, inArray } from "drizzle-orm";

/**
 * Find user IDs referenced by @-mentions in a freeform string.
 *
 * Matching rules:
 *   - Token form: "@Vorname" or "@vorname.nachname" — alphanumeric + dots,
 *     case-insensitive.
 *   - Resolve against the workspace's user list:
 *       1. Exact match on the user's first name (case-insensitive).
 *       2. If multiple users share a first name, the mention is ignored —
 *          encourages disambiguation via a unique form (full name with
 *          a dot or "@vorname-anfangsnachname").
 *       3. Substring match on the user's full name when the token has a
 *          dot ("@vorname.n" or "@vorname.nachname").
 *   - Skip the comment author themselves (no self-pings).
 *
 * Returns an array of distinct user IDs.
 */
export async function resolveMentions(
  text: string,
  workspaceId: string,
  excludeUserId: string
): Promise<string[]> {
  const tokens = Array.from(text.matchAll(/@([A-Za-z0-9._-]{2,40})/g)).map(
    (m) => m[1].toLowerCase()
  );
  if (tokens.length === 0) return [];

  // Pull every workspace member — single-tenant, small list.
  const memberRows = await db
    .select({
      userId: workspaceMembers.userId,
      name: users.name,
      email: users.email,
    })
    .from(workspaceMembers)
    .innerJoin(users, eq(users.id, workspaceMembers.userId))
    .where(eq(workspaceMembers.workspaceId, workspaceId));

  if (memberRows.length === 0) return [];

  const byFirstName = new Map<string, string[]>();
  for (const m of memberRows) {
    const first = (m.name ?? "").trim().split(/\s+/)[0]?.toLowerCase();
    if (!first) continue;
    const arr = byFirstName.get(first) ?? [];
    arr.push(m.userId);
    byFirstName.set(first, arr);
  }

  const matched = new Set<string>();
  for (const raw of tokens) {
    const token = raw.toLowerCase();
    // 1. Plain first name — only resolves if unambiguous.
    const exact = byFirstName.get(token);
    if (exact && exact.length === 1) {
      matched.add(exact[0]);
      continue;
    }
    // 2. Dotted form — match substring on full name.
    if (token.includes(".") || token.includes("-")) {
      const normalised = token.replace(/[.-]/g, " ");
      const found = memberRows.find((m) =>
        (m.name ?? "").toLowerCase().includes(normalised)
      );
      if (found) matched.add(found.userId);
    }
  }

  matched.delete(excludeUserId);
  return [...matched];
}

// Re-exports used by callers without dragging in extra drizzle imports.
export { and, eq, inArray };
