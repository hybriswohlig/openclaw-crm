import { NextRequest } from "next/server";
import { getAuthContext, unauthorized, notFound, success, badRequest } from "@/lib/api-utils";
import { db } from "@/db";
import { tradeFairs } from "@/db/schema";
import { eq, and } from "drizzle-orm";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();

  const { id } = await params;
  const body = await req.json();
  const { name, location, country, startDate, endDate, description, teamId } = body;

  if (name !== undefined && !name?.trim()) return badRequest("name cannot be empty");

  const [row] = await db
    .update(tradeFairs)
    .set({
      ...(name !== undefined && { name: name.trim() }),
      ...(location !== undefined && { location: location?.trim() || null }),
      ...(country !== undefined && { country: country?.trim() || null }),
      ...(startDate !== undefined && { startDate: startDate || null }),
      ...(endDate !== undefined && { endDate: endDate || null }),
      ...(description !== undefined && { description: description?.trim() || null }),
      ...(teamId !== undefined && { teamId: teamId || null }),
      updatedAt: new Date(),
    })
    .where(and(eq(tradeFairs.id, id), eq(tradeFairs.workspaceId, ctx.workspaceId)))
    .returning();

  if (!row) return notFound();
  return success(row);
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();

  const { id } = await params;

  const [row] = await db
    .delete(tradeFairs)
    .where(and(eq(tradeFairs.id, id), eq(tradeFairs.workspaceId, ctx.workspaceId)))
    .returning();

  if (!row) return notFound();
  return success({ deleted: true });
}
