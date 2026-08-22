import { NextRequest, NextResponse } from "next/server";
import { getAuthContext, unauthorized, notFound, badRequest, success } from "@/lib/api-utils";
import { listProjectMembers, addProjectMember } from "@/services/project-members";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();
  const { projectId } = await params;
  try {
    return success(await listProjectMembers(ctx.workspaceId, projectId));
  } catch (err) {
    console.error("GET project members error:", err);
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

  let body: { userId?: unknown; role?: unknown };
  try {
    body = (await req.json()) as { userId?: unknown; role?: unknown };
  } catch {
    return badRequest("Ungültiger JSON-Body.");
  }
  if (typeof body.userId !== "string" || !body.userId) {
    return badRequest("userId ist erforderlich.");
  }

  const member = await addProjectMember(
    ctx.workspaceId,
    projectId,
    ctx.userId, // actor — who is doing the adding
    body.userId, // subject — who is being added
    typeof body.role === "string" ? body.role : null,
  );
  if (!member) return notFound("Projekt oder Benutzer nicht gefunden");
  return success(member, 201);
}
