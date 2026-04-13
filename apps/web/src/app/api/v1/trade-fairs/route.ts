import { NextRequest } from "next/server";
import { getAuthContext, unauthorized, success, badRequest } from "@/lib/api-utils";
import { db } from "@/db";
import { tradeFairs, teams } from "@/db/schema";
import { eq, asc } from "drizzle-orm";

export async function GET(req: NextRequest) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();

  const rows = await db
    .select({
      id: tradeFairs.id,
      name: tradeFairs.name,
      location: tradeFairs.location,
      country: tradeFairs.country,
      startDate: tradeFairs.startDate,
      endDate: tradeFairs.endDate,
      description: tradeFairs.description,
      teamId: tradeFairs.teamId,
      teamName: teams.name,
      createdAt: tradeFairs.createdAt,
    })
    .from(tradeFairs)
    .leftJoin(teams, eq(teams.id, tradeFairs.teamId))
    .where(eq(tradeFairs.workspaceId, ctx.workspaceId))
    .orderBy(asc(tradeFairs.startDate), asc(tradeFairs.name));

  return success(rows);
}

export async function POST(req: NextRequest) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();

  const body = await req.json();
  const { name, location, country, startDate, endDate, description, teamId } = body;

  if (!name?.trim()) return badRequest("name is required");

  const [row] = await db
    .insert(tradeFairs)
    .values({
      workspaceId: ctx.workspaceId,
      name: name.trim(),
      location: location?.trim() || null,
      country: country?.trim() || null,
      startDate: startDate || null,
      endDate: endDate || null,
      description: description?.trim() || null,
      teamId: teamId || null,
    })
    .returning();

  return success(row, 201);
}
