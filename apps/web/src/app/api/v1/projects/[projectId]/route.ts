import { NextRequest, NextResponse } from "next/server";
import { getAuthContext, unauthorized, notFound, badRequest, success } from "@/lib/api-utils";
import { getProject, updateProject, deleteProject, parseProjectInput } from "@/services/projects";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();
  const { projectId } = await params;

  try {
    const project = await getProject(ctx.workspaceId, ctx.userId, projectId);
    if (!project) return notFound("Projekt nicht gefunden");
    return success(project);
  } catch (err) {
    console.error("GET project error:", err);
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: String(err) } },
      { status: 500 },
    );
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();
  const { projectId } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest("Ungültiger JSON-Body.");
  }

  const parsed = parseProjectInput(body, "update");
  if (!parsed.ok) return badRequest(parsed.error);

  try {
    const project = await updateProject(ctx.workspaceId, ctx.userId, projectId, parsed.input);
    if (!project) return notFound("Projekt nicht gefunden");
    return success(project);
  } catch (err) {
    console.error("PATCH project error:", err);
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: "Projekt konnte nicht geändert werden." } },
      { status: 500 },
    );
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();
  const { projectId } = await params;

  try {
    const ok = await deleteProject(ctx.workspaceId, projectId);
    if (!ok) return notFound("Projekt nicht gefunden");
    return success({ deleted: true });
  } catch (err) {
    console.error("DELETE project error:", err);
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: "Projekt konnte nicht gelöscht werden." } },
      { status: 500 },
    );
  }
}
