import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { users, workspaceMembers } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { adminEmailsConfigured, isAdminEmail } from "@/lib/admin-auth";

export async function GET(req: Request) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session?.user?.id) {
    return NextResponse.json(
      { error: { code: "UNAUTHORIZED", message: "Sign in required" } },
      { status: 401 }
    );
  }

  const email = session.user.email;
  const userId = session.user.id;

  // 1. Platform admin via ADMIN_EMAILS env var
  let admin = isAdminEmail(email);

  // 2. Platform admin via users.isAppAdmin DB column
  if (!admin) {
    const [row] = await db
      .select({ isAppAdmin: users.isAppAdmin })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (row?.isAppAdmin) admin = true;
  }

  // 3. Workspace admin in any workspace — granted access so they can run
  //    seed/repair on their own workspace.
  if (!admin) {
    const [wm] = await db
      .select({ id: workspaceMembers.id })
      .from(workspaceMembers)
      .where(
        and(
          eq(workspaceMembers.userId, userId),
          eq(workspaceMembers.role, "admin")
        )
      )
      .limit(1);
    if (wm) admin = true;
  }

  return NextResponse.json({
    data: {
      admin,
      adminEmailsConfigured: adminEmailsConfigured(),
    },
  });
}
