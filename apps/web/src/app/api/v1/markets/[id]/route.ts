import { NextRequest } from "next/server";
import { getAuthContext, unauthorized, notFound, success, badRequest } from "@/lib/api-utils";
import { db } from "@/db";
import { markets } from "@/db/schema";
import { eq, and } from "drizzle-orm";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();

  const { id } = await params;
  const body = await req.json();
  const { name, teamId, responsiblePerson } = body;

  if (name !== undefined && !name?.trim()) return badRequest("name cannot be empty");

  const [row] = await db
    .update(markets)
    .set({
      ...(name !== undefined && { name: name.trim() }),
      ...(teamId !== undefined && { teamId: teamId || null }),
      ...(responsiblePerson !== undefined && { responsiblePerson: responsiblePerson?.trim() || null }),
      updatedAt: new Date(),
    })
    .where(and(eq(markets.id, id), eq(markets.workspaceId, ctx.workspaceId)))
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
    .delete(markets)
    .where(and(eq(markets.id, id), eq(markets.workspaceId, ctx.workspaceId)))
    .returning();

  if (!row) return notFound();
  return success({ deleted: true });
}
