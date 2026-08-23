import { NextRequest, NextResponse } from "next/server";
import { getAuthContext, unauthorized, notFound, success } from "@/lib/api-utils";
import { getProject } from "@/services/projects";
import { listPhases } from "@/services/project-phases";
import { listMilestones } from "@/services/project-milestones";
import { listRisks } from "@/services/project-risks";
import { getBudget } from "@/services/project-budget";
import { listProjectDocuments } from "@/services/project-documents";

/** GET /api/v1/projects/[projectId]/overview — the KPI bundle of Mockup 2. */
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

    const [phases, milestones, risks, budget, documents] = await Promise.all([
      listPhases(ctx.workspaceId, projectId),
      listMilestones(ctx.workspaceId, projectId),
      listRisks(ctx.workspaceId, projectId),
      getBudget(ctx.workspaceId, projectId),
      listProjectDocuments(ctx.workspaceId, projectId),
    ]);

    return success({ project, phases, milestones, risks, budget, documents });
  } catch (err) {
    console.error("GET project overview error:", err);
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: String(err) } },
      { status: 500 },
    );
  }
}
