import type { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
export type AppUserRow = typeof users.$inferSelect;

export async function getAppAdminFromRequest(
  req: NextRequest
): Promise<{ userId: string; user: AppUserRow } | null> {
  const session = await auth.api.getSession({
    headers: req.headers,
  });
  if (!session?.user?.id) return null;

  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.id, session.user.id))
    .limit(1);

  if (
    !user ||
    user.approvalStatus !== "approved" ||
    !user.isAppAdmin
  ) {
    return null;
  }

  return { userId: session.user.id, user };
}
