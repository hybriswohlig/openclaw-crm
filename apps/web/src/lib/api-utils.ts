import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { workspaceMembers, apiKeys, workspaces } from "@/db/schema";
import { eq, and, isNull, asc } from "drizzle-orm";
import { createHash } from "crypto";

export interface AuthContext {
  userId: string;
  workspaceId: string;
  workspaceRole: "admin" | "member";
  authMethod?: "cookie" | "api_key";
}

function hashApiKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

/**
 * Get authenticated user and their workspace context.
 * Checks Bearer token first, then falls back to cookie auth.
 * Session users use their workspace membership (single tenant, oldest first).
 */
export async function getAuthContext(req: NextRequest): Promise<AuthContext | null> {
  // 1. Check for Bearer token auth
  const authHeader = req.headers.get("authorization");
  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.slice(7);
    if (token.startsWith("oc_sk_")) {
      return getApiKeyAuthContext(token);
    }
  }

  // 2. Fall back to cookie-based auth
  const session = await auth.api.getSession({
    headers: req.headers,
  });

  if (!session?.user?.id) {
    return null;
  }

  const userId = session.user.id;

  const memberships = await db
    .select({
      workspaceId: workspaceMembers.workspaceId,
      role: workspaceMembers.role,
    })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
    .where(eq(workspaceMembers.userId, userId))
    .orderBy(asc(workspaces.createdAt))
    .limit(1);

  if (memberships.length > 0) {
    return {
      userId,
      workspaceId: memberships[0].workspaceId,
      workspaceRole: memberships[0].role,
      authMethod: "cookie",
    };
  }

  return null;
}

async function getApiKeyAuthContext(token: string): Promise<AuthContext | null> {
  const keyHash = hashApiKey(token);

  const keys = await db
    .select({
      id: apiKeys.id,
      userId: apiKeys.userId,
      workspaceId: apiKeys.workspaceId,
      expiresAt: apiKeys.expiresAt,
    })
    .from(apiKeys)
    .where(and(eq(apiKeys.keyHash, keyHash), isNull(apiKeys.revokedAt)))
    .limit(1);

  if (keys.length === 0) {
    return null;
  }

  const key = keys[0];

  // Check expiration
  if (key.expiresAt && key.expiresAt < new Date()) {
    return null;
  }

  // Fire-and-forget: update last_used_at
  db.update(apiKeys)
    .set({ lastUsedAt: new Date() })
    .where(eq(apiKeys.id, key.id))
    .execute()
    .catch(() => {});

  // Look up the user's workspace role
  const memberships = await db
    .select({ role: workspaceMembers.role })
    .from(workspaceMembers)
    .where(
      and(
        eq(workspaceMembers.userId, key.userId),
        eq(workspaceMembers.workspaceId, key.workspaceId)
      )
    )
    .limit(1);

  const role = memberships.length > 0 ? memberships[0].role : "member";

  return {
    userId: key.userId,
    workspaceId: key.workspaceId,
    workspaceRole: role,
    authMethod: "api_key",
  };
}

/** Return a 401 JSON response */
export function unauthorized() {
  return NextResponse.json(
    { error: { code: "UNAUTHORIZED", message: "Authentication required" } },
    { status: 401 }
  );
}

/** Return a 404 JSON response */
export function notFound(message = "Not found") {
  return NextResponse.json(
    { error: { code: "NOT_FOUND", message } },
    { status: 404 }
  );
}

/** Return a 403 JSON response */
export function forbidden(message = "Insufficient permissions") {
  return NextResponse.json(
    { error: { code: "FORBIDDEN", message } },
    { status: 403 }
  );
}

/** Check if user is admin, return 403 response if not */
export function requireAdmin(ctx: AuthContext): NextResponse | null {
  if (ctx.workspaceRole !== "admin") {
    return forbidden("Admin access required");
  }
  return null;
}

/** Return a 400 JSON response */
export function badRequest(message: string) {
  return NextResponse.json(
    { error: { code: "BAD_REQUEST", message } },
    { status: 400 }
  );
}

/** Return a success JSON response */
export function success<T>(data: T, status = 200) {
  return NextResponse.json({ data }, { status });
}
