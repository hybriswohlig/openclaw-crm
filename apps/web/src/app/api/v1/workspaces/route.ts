import { NextRequest } from "next/server";
import { getAuthContext, success, unauthorized, forbidden } from "@/lib/api-utils";
import { listUserWorkspaces } from "@/services/workspace";

/** GET /api/v1/workspaces — The single organization (0 or 1 row) for approved members */
export async function GET(req: NextRequest) {
  const ctx = await getAuthContext(req);
  if (!ctx) {
    return unauthorized();
  }

  const workspaces = await listUserWorkspaces(ctx.userId);
  return success(workspaces);
}

/** POST disabled — this deployment uses one shared workspace (created via seed). */
export async function POST() {
  return forbidden("Creating additional workspaces is not supported");
}
