import { NextRequest } from "next/server";
import { getAuthContext, unauthorized, notFound, badRequest, success } from "@/lib/api-utils";
import { updateMilestone, deleteMilestone } from "@/services/project-milestones";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ projectId: string; milestoneId: string }> },
) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();
  const { milestoneId } = await params;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return badRequest("Ungültiger JSON-Body.");
  }

  try {
    const milestone = await updateMilestone(ctx.workspaceId, ctx.userId, milestoneId, body);
    if (!milestone) return notFound("Meilenstein nicht gefunden");
    return success(milestone);
  } catch (err) {
    return badRequest(
      err instanceof Error ? err.message : "Meilenstein konnte nicht geändert werden.",
    );
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ projectId: string; milestoneId: string }> },
) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();
  const { milestoneId } = await params;

  const ok = await deleteMilestone(ctx.workspaceId, milestoneId);
  if (!ok) return notFound("Meilenstein nicht gefunden");
  return success({ deleted: true });
}
