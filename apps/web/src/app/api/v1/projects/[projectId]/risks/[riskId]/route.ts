import { NextRequest } from "next/server";
import { getAuthContext, unauthorized, notFound, badRequest, success } from "@/lib/api-utils";
import { updateRisk, deleteRisk } from "@/services/project-risks";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ projectId: string; riskId: string }> },
) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();
  const { riskId } = await params;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return badRequest("Ungültiger JSON-Body.");
  }

  try {
    const risk = await updateRisk(ctx.workspaceId, ctx.userId, riskId, body);
    if (!risk) return notFound("Risiko nicht gefunden");
    return success(risk);
  } catch (err) {
    return badRequest(err instanceof Error ? err.message : "Risiko konnte nicht geändert werden.");
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ projectId: string; riskId: string }> },
) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();
  const { riskId } = await params;

  const ok = await deleteRisk(ctx.workspaceId, riskId);
  if (!ok) return notFound("Risiko nicht gefunden");
  return success({ deleted: true });
}
