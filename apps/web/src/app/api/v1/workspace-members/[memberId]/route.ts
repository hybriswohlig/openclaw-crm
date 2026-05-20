import { NextRequest } from "next/server";
import { getAuthContext, unauthorized, notFound, badRequest, success } from "@/lib/api-utils";
import {
  updateMemberRole,
  updateMemberPermissions,
  removeMember,
} from "@/services/workspace";
import type { MemberPermissions } from "@/db/schema/workspace";

/** Whitelist the permission keys we recognise — anything else is ignored. */
const KNOWN_PERMISSION_KEYS: ReadonlySet<keyof MemberPermissions> = new Set([
  "manageChannels",
]);

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ memberId: string }> }
) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();

  if (ctx.workspaceRole !== "admin") {
    return badRequest("Only admins can change member roles or permissions");
  }

  const { memberId } = await params;
  const body = (await req.json().catch(() => ({}))) as {
    role?: unknown;
    permissions?: unknown;
  };

  // Either role, permissions, or both. At least one must be present.
  const hasRole = body.role !== undefined;
  const hasPermissions = body.permissions !== undefined;
  if (!hasRole && !hasPermissions) {
    return badRequest("Provide 'role' and/or 'permissions' to update");
  }

  let updated: Awaited<ReturnType<typeof updateMemberRole>> | null = null;

  if (hasRole) {
    if (body.role !== "admin" && body.role !== "member") {
      return badRequest("role must be 'admin' or 'member'");
    }
    updated = await updateMemberRole(ctx.workspaceId, memberId, body.role);
    if (!updated) return notFound("Member not found");
  }

  if (hasPermissions) {
    if (
      !body.permissions ||
      typeof body.permissions !== "object" ||
      Array.isArray(body.permissions)
    ) {
      return badRequest("permissions must be an object");
    }
    const patch: MemberPermissions = {};
    for (const [k, v] of Object.entries(body.permissions)) {
      if (!KNOWN_PERMISSION_KEYS.has(k as keyof MemberPermissions)) continue;
      if (typeof v !== "boolean") {
        return badRequest(`permissions.${k} must be a boolean`);
      }
      patch[k as keyof MemberPermissions] = v;
    }
    updated = await updateMemberPermissions(ctx.workspaceId, memberId, patch);
    if (!updated) return notFound("Member not found");
  }

  return success(updated);
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ memberId: string }> }
) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();

  if (ctx.workspaceRole !== "admin") {
    return badRequest("Only admins can remove members");
  }

  const { memberId } = await params;

  try {
    const removed = await removeMember(ctx.workspaceId, memberId);
    if (!removed) return notFound("Member not found");
    return success(removed);
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Failed to remove member";
    return badRequest(message);
  }
}
