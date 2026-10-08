import { NextRequest } from "next/server";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { success, forbidden, notFound, badRequest } from "@/lib/api-utils";
import { getAppAdminFromRequest } from "@/lib/require-app-admin";
import { revokeUserAccess } from "@/services/workspace";

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

  // Gleicher Ablauf wie „Mitglied entfernen“: Freigabe, Sitzungen, Push-Abos,
  // Mitgliedschaften und API-Schlüssel in einem Rutsch.
  await db.transaction((tx) => revokeUserAccess(tx, userId));

  return success({ id: userId, approvalStatus: "rejected" });
}
