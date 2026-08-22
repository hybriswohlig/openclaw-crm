import { NextRequest } from "next/server";
import { getAuthContext, unauthorized, notFound, badRequest, success } from "@/lib/api-utils";
import { updatePhase, deletePhase } from "@/services/project-phases";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ projectId: string; phaseId: string }> },
) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();
  const { phaseId } = await params;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return badRequest("Ungültiger JSON-Body.");
  }

  try {
    const phase = await updatePhase(ctx.workspaceId, ctx.userId, phaseId, body);
    if (!phase) return notFound("Phase nicht gefunden");
    return success(phase);
  } catch (err) {
    return badRequest(err instanceof Error ? err.message : "Phase konnte nicht geändert werden.");
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ projectId: string; phaseId: string }> },
) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();
  const { phaseId } = await params;

  const ok = await deletePhase(ctx.workspaceId, phaseId);
  if (!ok) return notFound("Phase nicht gefunden");
  return success({ deleted: true });
}
