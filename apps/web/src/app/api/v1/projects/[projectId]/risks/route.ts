import { NextRequest, NextResponse } from "next/server";
import { getAuthContext, unauthorized, notFound, badRequest, success } from "@/lib/api-utils";
import { listRisks, createRisk } from "@/services/project-risks";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();
  const { projectId } = await params;
  try {
    return success(await listRisks(ctx.workspaceId, projectId));
  } catch (err) {
    console.error("GET risks error:", err);
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
    const risk = await createRisk(ctx.workspaceId, projectId, ctx.userId, {
      title: String(body.title ?? ""),
      description: typeof body.description === "string" ? body.description : null,
      severity: typeof body.severity === "string" ? body.severity : null,
      likelihood: typeof body.likelihood === "string" ? body.likelihood : null,
      mitigation: typeof body.mitigation === "string" ? body.mitigation : null,
      ownerUserId: typeof body.ownerUserId === "string" ? body.ownerUserId : null,
    });
    if (!risk) return notFound("Projekt nicht gefunden");
    return success(risk, 201);
  } catch (err) {
    return badRequest(err instanceof Error ? err.message : "Risiko konnte nicht angelegt werden.");
  }
}
