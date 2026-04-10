import { NextRequest } from "next/server";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq, desc } from "drizzle-orm";
import { success, forbidden } from "@/lib/api-utils";
import { getAppAdminFromRequest } from "@/lib/require-app-admin";

export async function GET(req: NextRequest) {
  const admin = await getAppAdminFromRequest(req);
  if (!admin) {
    return forbidden("App admin access required");
  }

  const pending = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      createdAt: users.createdAt,
    })
    .from(users)
    .where(eq(users.approvalStatus, "pending"))
    .orderBy(desc(users.createdAt));

  return success(pending);
}
