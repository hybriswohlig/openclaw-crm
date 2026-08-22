import { NextRequest } from "next/server";
import { getAuthContext, unauthorized, badRequest, success } from "@/lib/api-utils";
import { reorderPhases } from "@/services/project-phases";

/** POST /api/v1/projects/[projectId]/phases/reorder — { orderedPhaseIds } */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();
  const { projectId } = await params;

  let body: { orderedPhaseIds?: unknown };
  try {
    body = (await req.json()) as { orderedPhaseIds?: unknown };
  } catch {
    return badRequest("Ungültiger JSON-Body.");
  }
  if (!Array.isArray(body.orderedPhaseIds)) {
    return badRequest("orderedPhaseIds muss eine Liste von IDs sein.");
  }

  const ids = body.orderedPhaseIds.filter((v): v is string => typeof v === "string");
  return success(await reorderPhases(ctx.workspaceId, projectId, ids));
}
