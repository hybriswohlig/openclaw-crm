import { NextRequest } from "next/server";
import { db } from "@/db";
import { users, sessions, workspaceMembers } from "@/db/schema";
import { eq } from "drizzle-orm";
import { success, forbidden, notFound, badRequest } from "@/lib/api-utils";
import { getAppAdminFromRequest } from "@/lib/require-app-admin";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  const admin = await getAppAdminFromRequest(req);
  if (!admin) {
    return forbidden("App admin access required");
  }

  const { userId } = await params;
  if (userId === admin.userId) {
    return badRequest("Cannot reject your own account");
  }

  const [target] = await db
    .select()
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!target) {
    return notFound("User not found");
  }

  await db.delete(sessions).where(eq(sessions.userId, userId));

  await db.delete(workspaceMembers).where(eq(workspaceMembers.userId, userId));

  await db
    .update(users)
    .set({
      approvalStatus: "rejected",
      updatedAt: new Date(),
    })
    .where(eq(users.id, userId));

  return success({ id: userId, approvalStatus: "rejected" });
}
