import { NextRequest } from "next/server";
import {
  getAuthContext,
  unauthorized,
  forbidden,
  notFound,
  badRequest,
  success,
} from "@/lib/api-utils";
import { db } from "@/db";
import { users, workspaceMembers } from "@/db/schema";
import { and, eq } from "drizzle-orm";

/**
 * POST /api/v1/admin/approvals/[userId]
 * Body: { action: "approve" | "reject" }
 *
 * approve → marks user as approved AND adds them to the caller's workspace
 *           as a plain member (not admin). Idempotent: if they're already
 *           a member, just bumps their status.
 * reject  → marks user as rejected. They stay in the users table but
 *           getAuthContext's self-heal won't bootstrap a workspace for them.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();
  if (ctx.workspaceRole !== "admin") return forbidden("Admin access required");

  const { userId } = await params;
  const body = await req.json().catch(() => ({}));
  const action = (body as { action?: string }).action;

  if (action !== "approve" && action !== "reject") {
    return badRequest("action must be 'approve' or 'reject'");
  }

  // Verify the user exists
  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!user) return notFound("User not found");

  if (action === "reject") {
    await db
      .update(users)
      .set({ approvalStatus: "rejected" })
      .where(eq(users.id, userId));
    // If they were already added to the workspace, remove the membership
    await db
      .delete(workspaceMembers)
      .where(
        and(
          eq(workspaceMembers.userId, userId),
          eq(workspaceMembers.workspaceId, ctx.workspaceId)
        )
      );
    return success({ id: userId, approvalStatus: "rejected" });
  }

  // approve
  await db
    .update(users)
    .set({ approvalStatus: "approved" })
    .where(eq(users.id, userId));

  // Add to the admin's workspace as a plain member (idempotent)
  await db
    .insert(workspaceMembers)
    .values({ workspaceId: ctx.workspaceId, userId, role: "member" })
    .onConflictDoNothing();

  return success({
    id: userId,
    approvalStatus: "approved",
    workspaceId: ctx.workspaceId,
  });
}
