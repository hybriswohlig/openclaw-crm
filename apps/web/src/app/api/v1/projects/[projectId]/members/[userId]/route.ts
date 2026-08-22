import { NextRequest } from "next/server";
import { getAuthContext, unauthorized, notFound, badRequest, success } from "@/lib/api-utils";
import { updateProjectMemberRole, removeProjectMember } from "@/services/project-members";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ projectId: string; userId: string }> },
) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();
  const { projectId, userId } = await params;

  let body: { role?: unknown };
  try {
    body = (await req.json()) as { role?: unknown };
  } catch {
    return badRequest("Ungültiger JSON-Body.");
  }
  if (typeof body.role !== "string") return badRequest("role ist erforderlich.");

  try {
    // F5: updateProjectMemberRole now throws (not returns null) for an
    // invalid role, matching addProjectMember's POST sibling above — so an
    // invalid role reads as 400, and null means only "genuinely not found".
    const member = await updateProjectMemberRole(
      ctx.workspaceId,
      projectId,
      ctx.userId, // actor — who is changing the role
      userId, // subject — whose role is changing
      body.role,
    );
    if (!member) return notFound("Mitglied nicht gefunden");
    return success(member);
  } catch (err) {
    return badRequest(
      err instanceof Error ? err.message : "Rolle konnte nicht geändert werden.",
    );
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ projectId: string; userId: string }> },
) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();
  const { projectId, userId } = await params;

  const ok = await removeProjectMember(ctx.workspaceId, projectId, ctx.userId, userId);
  if (!ok) return notFound("Mitglied nicht gefunden");
  return success({ deleted: true });
}
