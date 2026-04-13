import { NextRequest } from "next/server";
import { getAuthContext, unauthorized, success, badRequest } from "@/lib/api-utils";
import { db } from "@/db";
import { markets, teams } from "@/db/schema";
import { eq, asc } from "drizzle-orm";

export async function GET(req: NextRequest) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();

  const rows = await db
    .select({
      id: markets.id,
      name: markets.name,
      teamId: markets.teamId,
      teamName: teams.name,
      responsiblePerson: markets.responsiblePerson,
      createdAt: markets.createdAt,
    })
    .from(markets)
    .leftJoin(teams, eq(teams.id, markets.teamId))
    .where(eq(markets.workspaceId, ctx.workspaceId))
    .orderBy(asc(markets.name));

  return success(rows);
}

export async function POST(req: NextRequest) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();

  const body = await req.json();
  const { name, teamId, responsiblePerson } = body;

  if (!name?.trim()) return badRequest("name is required");

  const [row] = await db
    .insert(markets)
    .values({
      workspaceId: ctx.workspaceId,
      name: name.trim(),
      teamId: teamId || null,
      responsiblePerson: responsiblePerson?.trim() || null,
    })
    .returning();

  return success(row, 201);
}
