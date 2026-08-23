import { NextRequest, NextResponse } from "next/server";
import { getAuthContext, unauthorized, notFound, badRequest, success } from "@/lib/api-utils";
import { listMilestones, createMilestone } from "@/services/project-milestones";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();
  const { projectId } = await params;
  try {
    return success(await listMilestones(ctx.workspaceId, projectId));
  } catch (err) {
    console.error("GET milestones error:", err);
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: String(err) } },
      { status: 500 },
    );
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();
  const { projectId } = await params;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return badRequest("Ungültiger JSON-Body.");
  }

  try {
    const milestone = await createMilestone(ctx.workspaceId, projectId, ctx.userId, {
      name: String(body.name ?? ""),
      dueDate: typeof body.dueDate === "string" ? body.dueDate : null,
      phaseId: typeof body.phaseId === "string" ? body.phaseId : null,
      status: typeof body.status === "string" ? body.status : null,
    });
    if (!milestone) return notFound("Projekt nicht gefunden");
    return success(milestone, 201);
  } catch (err) {
    return badRequest(
      err instanceof Error ? err.message : "Meilenstein konnte nicht angelegt werden.",
    );
  }
}
