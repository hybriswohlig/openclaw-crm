import { NextRequest } from "next/server";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { success, forbidden, notFound } from "@/lib/api-utils";
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

  const [target] = await db
    .select()
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!target) {
    return notFound("User not found");
  }

  if (target.approvalStatus === "approved") {
    return success({ id: userId, approvalStatus: "approved" });
  }

  await db
    .update(users)
    .set({
      approvalStatus: "approved",
      updatedAt: new Date(),
    })
    .where(eq(users.id, userId));

  return success({ id: userId, approvalStatus: "approved" });
}
