import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { workspaceMembers, apiKeys, users } from "@/db/schema";
import type { MemberPermissions } from "@/db/schema/workspace";
import { eq, and, isNull } from "drizzle-orm";
import { createHash } from "crypto";
import {
  ensureUserWorkspaceAccess,
  getSingletonWorkspaceId,
} from "@/services/workspace";

export interface AuthContext {
  userId: string;
  workspaceId: string;
  workspaceRole: "admin" | "member";
  /**
   * Granular permissions granted to this member on top of their role.
   * Admins implicitly have every permission regardless of what's set here;
   * code that gates on a capability should still call the matching `require*`
   * helper which honours the admin shortcut.
   */
  permissions: MemberPermissions;
  authMethod?: "cookie" | "api_key";
}

function hashApiKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

/**
 * Get authenticated user and their workspace context.
 * Single-tenant: one workspace per deployment. Only approved users receive context.
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

  const [userRow] = await db
    .select({
      approvalStatus: users.approvalStatus,
      isAppAdmin: users.isAppAdmin,
      role: users.role,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!userRow || userRow.approvalStatus !== "approved") {
    return null;
  }

  // Employee-portal accounts must never receive CRM workspace context.
  // They are approved for the mobile portal only; auto-membership would
  // escalate them to full CRM API access.
  if (userRow.role === "employee") {
    return null;
  }

  const access = await ensureUserWorkspaceAccess(userId, userRow.isAppAdmin);
  if (!access) {
    return null;
  }

  return {
    userId,
    workspaceId: access.workspaceId,
    workspaceRole: access.role,
    permissions: access.permissions,
    authMethod: "cookie",
  };
}

async function getApiKeyAuthContext(token: string): Promise<AuthContext | null> {
  const keyHash = hashApiKey(token);

  const keys = await db
    .select({
      id: apiKeys.id,
      userId: apiKeys.userId,
      workspaceId: apiKeys.workspaceId,
      expiresAt: apiKeys.expiresAt,
      lastUsedAt: apiKeys.lastUsedAt,
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

  const [userRow] = await db
    .select({ approvalStatus: users.approvalStatus, role: users.role })
    .from(users)
    .where(eq(users.id, key.userId))
    .limit(1);

  if (!userRow || userRow.approvalStatus !== "approved") {
    return null;
  }
  if (userRow.role === "employee") {
    return null;
  }

  const singletonId = await getSingletonWorkspaceId();
  if (!singletonId || key.workspaceId !== singletonId) {
    return null;
  }

  // Throttle last_used_at writes to once per 5 minutes per key.
  // Without this, every API request fires a WAL-generating UPDATE on a tiny
  // 10-row table — observed >14k updates/month, the second-largest source of
  // wasted Neon compute behind the inbox-sync cron.
  const LAST_USED_THROTTLE_MS = 5 * 60 * 1000;
  const now = new Date();
  if (
    !key.lastUsedAt ||
    now.getTime() - key.lastUsedAt.getTime() > LAST_USED_THROTTLE_MS
  ) {
    db.update(apiKeys)
      .set({ lastUsedAt: now })
      .where(eq(apiKeys.id, key.id))
      .execute()
      .catch(() => {});
  }

  // Look up the user's workspace role + granular permissions
  const memberships = await db
    .select({
      role: workspaceMembers.role,
      permissions: workspaceMembers.permissions,
    })
    .from(workspaceMembers)
    .where(
      and(
        eq(workspaceMembers.userId, key.userId),
        eq(workspaceMembers.workspaceId, key.workspaceId)
      )
    )
    .limit(1);

  const role = memberships.length > 0 ? memberships[0].role : "member";
  const permissions = memberships.length > 0 ? memberships[0].permissions ?? {} : {};

  return {
    userId: key.userId,
    workspaceId: key.workspaceId,
    workspaceRole: role,
    permissions,
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

/** Admin OR member with the `manageChannels` permission. */
export function canManageChannels(ctx: AuthContext): boolean {
  return ctx.workspaceRole === "admin" || ctx.permissions?.manageChannels === true;
}

/** Gate channel-account mutation routes — returns 403 if the caller can't manage channels. */
export function requireChannelManager(ctx: AuthContext): NextResponse | null {
  if (!canManageChannels(ctx)) {
    return forbidden("You don't have permission to manage inbox channels.");
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
