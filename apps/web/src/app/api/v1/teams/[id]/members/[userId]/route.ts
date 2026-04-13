import { NextRequest } from "next/server";
import {
  getAuthContext,
  unauthorized,
  forbidden,
  notFound,
  success,
} from "@/lib/api-utils";
import { db } from "@/db";
import { teams, teamMembers } from "@/db/schema";
import { eq, and } from "drizzle-orm";

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; userId: string }> }
) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();
  if (ctx.workspaceRole !== "admin") return forbidden();

  const { id, userId } = await params;

  // Verify team belongs to this workspace
  const [team] = await db
    .select()
    .from(teams)
    .where(and(eq(teams.id, id), eq(teams.workspaceId, ctx.workspaceId)))
    .limit(1);
  if (!team) return notFound();

  const [row] = await db
    .delete(teamMembers)
    .where(and(eq(teamMembers.teamId, id), eq(teamMembers.userId, userId)))
    .returning();

  if (!row) return notFound();
  return success({ deleted: true });
}
