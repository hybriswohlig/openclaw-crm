import { NextRequest, NextResponse } from "next/server";
import { getAuthContext, unauthorized, badRequest, success } from "@/lib/api-utils";
import { listDependencies, addDependency } from "@/services/task-dependencies";

/** GET — every dependency that touches this task. */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ taskId: string }> },
) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();
  const { taskId } = await params;
  try {
    return success(await listDependencies(ctx.workspaceId, { taskIds: [taskId] }));
  } catch (err) {
    console.error("GET dependencies error:", err);
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: String(err) } },
      { status: 500 },
    );
  }
}

/**
 * POST — declare that this task waits for another one.
 *
 * `[taskId]` in the URL is ALWAYS the successor: the task that waits owns
 * the edge. The body names the task it waits for:
 *
 *     { "predecessorTaskId": "<id>" }
 *
 * There is deliberately no `direction` flag. The earlier taskId+direction
 * scheme let the UI, the MCP layer and this route disagree about which end
 * of the edge the URL meant.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ taskId: string }> },
) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();
  const { taskId: successorTaskId } = await params;

  let body: { predecessorTaskId?: unknown };
  try {
    body = (await req.json()) as { predecessorTaskId?: unknown };
  } catch {
    return badRequest("Ungültiger JSON-Body.");
  }

  const predecessorTaskId =
    typeof body.predecessorTaskId === "string" ? body.predecessorTaskId.trim() : "";
  if (!predecessorTaskId) {
    return badRequest("predecessorTaskId ist erforderlich.");
  }
  if (predecessorTaskId === successorTaskId) {
    return badRequest("Eine Aufgabe kann nicht von sich selbst abhängen.");
  }

  const result = await addDependency(ctx.workspaceId, predecessorTaskId, successorTaskId);
  if (result.error) return badRequest(result.error);
  return success(result.dependency, 201);
}
