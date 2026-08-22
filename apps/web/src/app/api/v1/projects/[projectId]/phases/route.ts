import { NextRequest, NextResponse } from "next/server";
import { getAuthContext, unauthorized, notFound, badRequest, success } from "@/lib/api-utils";
import { listPhases, createPhase } from "@/services/project-phases";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();
  const { projectId } = await params;
  try {
    return success(await listPhases(ctx.workspaceId, projectId));
  } catch (err) {
    console.error("GET phases error:", err);
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
    const phase = await createPhase(ctx.workspaceId, projectId, ctx.userId, {
      name: String(body.name ?? ""),
      description: typeof body.description === "string" ? body.description : null,
      startDate: typeof body.startDate === "string" ? body.startDate : null,
      dueDate: typeof body.dueDate === "string" ? body.dueDate : null,
      status: typeof body.status === "string" ? body.status : null,
    });
    if (!phase) return notFound("Projekt nicht gefunden");
    return success(phase, 201);
  } catch (err) {
    return badRequest(err instanceof Error ? err.message : "Phase konnte nicht angelegt werden.");
  }
}
