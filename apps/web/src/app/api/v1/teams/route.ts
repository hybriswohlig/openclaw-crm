import { NextRequest } from "next/server";
import { getAuthContext, unauthorized, success, badRequest } from "@/lib/api-utils";
import { db } from "@/db";
import { teams } from "@/db/schema";
import { eq, asc } from "drizzle-orm";

export async function GET(req: NextRequest) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();

  const rows = await db
    .select()
    .from(teams)
    .where(eq(teams.workspaceId, ctx.workspaceId))
    .orderBy(asc(teams.name));

  return success(rows);
}

export async function POST(req: NextRequest) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();

  const body = await req.json();
  const { name, key, responsiblePerson } = body;

  if (!name?.trim()) return badRequest("name is required");

  const [row] = await db
    .insert(teams)
    .values({
      workspaceId: ctx.workspaceId,
      key: key?.trim() || "custom",
      name: name.trim(),
      responsiblePerson: responsiblePerson?.trim() || null,
    })
    .returning();

  return success(row, 201);
}
