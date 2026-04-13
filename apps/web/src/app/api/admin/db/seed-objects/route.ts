import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { isAdminEmail } from "@/lib/admin-auth";
import { getAuthContext } from "@/lib/api-utils";
import { seedWorkspaceObjects, seedWorkspaceTeams } from "@/services/workspace";

/**
 * POST /api/admin/db/seed-objects
 * Re-seeds standard objects, attributes, and stages for the caller's workspace.
 * Idempotent — safe to run on an existing workspace to add missing objects/fields.
 * Requires either: platform admin email OR workspace admin role.
 */
export async function POST(req: NextRequest) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const ctx = await getAuthContext(req);
  const isPlatformAdmin = isAdminEmail(session.user.email);
  const isWorkspaceAdmin = ctx?.workspaceRole === "admin";

  if (!isPlatformAdmin && !isWorkspaceAdmin) {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  if (!ctx?.workspaceId) {
    return NextResponse.json({ error: "No workspace found for this account" }, { status: 400 });
  }

  await seedWorkspaceObjects(ctx.workspaceId);
  await seedWorkspaceTeams(ctx.workspaceId);

  return NextResponse.json({ data: { ok: true, workspaceId: ctx.workspaceId } });
}
