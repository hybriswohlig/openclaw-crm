import { NextRequest } from "next/server";
import { getAuthContext, unauthorized, forbidden, success } from "@/lib/api-utils";
import { db } from "@/db";
import { users, workspaceMembers } from "@/db/schema";
import { eq, notInArray, desc, and } from "drizzle-orm";

/**
 * GET /api/v1/admin/approvals
 * Returns users who need action:
 *   - pending: signed up but not yet approved
 *   - rejected: explicitly denied access
 * Only workspace admins can see this list.
 *
 * Users auto-approved via the vi-kang.com domain hook are filtered out
 * because they already have a workspace membership.
 */
export async function GET(req: NextRequest) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();
  if (ctx.workspaceRole !== "admin") return forbidden("Admin access required");

  // Users already in the admin's workspace — exclude them from the queue.
  const existingMembers = await db
    .select({ userId: workspaceMembers.userId })
    .from(workspaceMembers)
    .where(eq(workspaceMembers.workspaceId, ctx.workspaceId));

  const existingIds = existingMembers.map((m) => m.userId);

  const rows = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      image: users.image,
      approvalStatus: users.approvalStatus,
      createdAt: users.createdAt,
    })
    .from(users)
    .where(
      existingIds.length > 0 ? notInArray(users.id, existingIds) : undefined
    )
    .orderBy(desc(users.createdAt));

  // Bucket by status for easy rendering
  const pending = rows.filter((r) => r.approvalStatus === "pending");
  const rejected = rows.filter((r) => r.approvalStatus === "rejected");
  const approvedNoWorkspace = rows.filter(
    (r) => r.approvalStatus === "approved"
  );

  return success({ pending, rejected, approvedNoWorkspace });
}
