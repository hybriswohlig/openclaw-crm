import { NextRequest } from "next/server";
import { getAuthContext, unauthorized, notFound, success } from "@/lib/api-utils";
import { removeDependency } from "@/services/task-dependencies";

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ taskId: string; dependencyId: string }> },
) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();
  const { dependencyId } = await params;

  const ok = await removeDependency(ctx.workspaceId, dependencyId);
  if (!ok) return notFound("Abhängigkeit nicht gefunden");
  return success({ deleted: true });
}
