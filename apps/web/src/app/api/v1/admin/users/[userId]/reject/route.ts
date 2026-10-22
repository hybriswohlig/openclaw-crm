import { NextRequest } from "next/server";
import { db } from "@/db";
import { users, workspaceMembers } from "@/db/schema";
import { eq } from "drizzle-orm";
import { success, forbidden, notFound, badRequest } from "@/lib/api-utils";
import { getAppAdminFromRequest } from "@/lib/require-app-admin";
import { endUserAccess } from "@/services/workspace";

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

  await db.transaction(async (tx) => {
    await tx.delete(workspaceMembers).where(eq(workspaceMembers.userId, userId));
    await endUserAccess(tx, userId);
  });

  return success({ id: userId, approvalStatus: "rejected" });
}
