import { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { success, unauthorized } from "@/lib/api-utils";

/** For the dashboard gate: session may exist while account is still pending. */
export async function GET(req: NextRequest) {
  const session = await auth.api.getSession({
    headers: req.headers,
  });

  if (!session?.user?.id) {
    return unauthorized();
  }

  const [user] = await db
    .select({
      approvalStatus: users.approvalStatus,
      isAppAdmin: users.isAppAdmin,
    })
    .from(users)
    .where(eq(users.id, session.user.id))
    .limit(1);

  if (!user) {
    return unauthorized();
  }

  return success({
    approvalStatus: user.approvalStatus,
    isAppAdmin: user.isAppAdmin,
  });
}
