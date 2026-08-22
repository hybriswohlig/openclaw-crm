import { NextRequest, NextResponse } from "next/server";
import { getAuthContext, unauthorized, notFound, success } from "@/lib/api-utils";
import { getProject, setProjectFavorite } from "@/services/projects";

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();
  const { projectId } = await params;

  try {
    const project = await getProject(ctx.workspaceId, ctx.userId, projectId);
    if (!project) return notFound("Projekt nicht gefunden");
    await setProjectFavorite(ctx.userId, projectId, true);
    return success({ isFavorite: true });
  } catch (err) {
    console.error("PUT project favorite error:", err);
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: String(err) } },
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
    await setProjectFavorite(ctx.userId, projectId, false);
    return success({ isFavorite: false });
  } catch (err) {
    console.error("DELETE project favorite error:", err);
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: String(err) } },
      { status: 500 },
    );
  }
}
