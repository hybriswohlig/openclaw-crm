import { NextRequest } from "next/server";
import {
  getAuthContext,
  unauthorized,
  forbidden,
  notFound,
  success,
  badRequest,
} from "@/lib/api-utils";
import { db } from "@/db";
import { teams, teamMembers } from "@/db/schema";
import { workspaceMembers, users } from "@/db/schema";
import { eq, and } from "drizzle-orm";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();

  const { id } = await params;

  // Verify team belongs to this workspace
  const [team] = await db
    .select()
    .from(teams)
    .where(and(eq(teams.id, id), eq(teams.workspaceId, ctx.workspaceId)))
    .limit(1);
  if (!team) return notFound();

  const members = await db
    .select({
      id: teamMembers.id,
      userId: teamMembers.userId,
      name: users.name,
      email: users.email,
      image: users.image,
      createdAt: teamMembers.createdAt,
    })
    .from(teamMembers)
    .innerJoin(users, eq(users.id, teamMembers.userId))
    .where(eq(teamMembers.teamId, id));

  return success(members);
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();
  if (ctx.workspaceRole !== "admin") return forbidden();

  const { id } = await params;

  // Verify team belongs to this workspace
  const [team] = await db
    .select()
    .from(teams)
    .where(and(eq(teams.id, id), eq(teams.workspaceId, ctx.workspaceId)))
    .limit(1);
  if (!team) return notFound();

  const body = await req.json();
  const { userId } = body;
  if (!userId) return badRequest("userId is required");

  // Verify user is a member of this workspace
  const [wm] = await db
    .select()
    .from(workspaceMembers)
    .where(
      and(
        eq(workspaceMembers.userId, userId),
        eq(workspaceMembers.workspaceId, ctx.workspaceId)
      )
    )
    .limit(1);
  if (!wm) return badRequest("User is not a member of this workspace");

  const [row] = await db
    .insert(teamMembers)
    .values({ teamId: id, userId })
    .onConflictDoNothing()
    .returning();

  return success(row ?? { teamId: id, userId }, 201);
}
