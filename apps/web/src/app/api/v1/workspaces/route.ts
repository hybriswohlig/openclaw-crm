import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { success, badRequest } from "@/lib/api-utils";
import { createWorkspace, listUserWorkspaces } from "@/services/workspace";

/** GET /api/v1/workspaces — List workspaces the current user belongs to */
export async function GET(req: NextRequest) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session?.user?.id) {
    return NextResponse.json(
      { error: { code: "UNAUTHORIZED", message: "Authentication required" } },
      { status: 401 }
    );
  }

  const workspaces = await listUserWorkspaces(session.user.id);
  return success(workspaces);
}

/** POST /api/v1/workspaces — Create a new workspace */
export async function POST(req: NextRequest) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session?.user?.id) {
    return NextResponse.json(
      { error: { code: "UNAUTHORIZED", message: "Authentication required" } },
      { status: 401 }
    );
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return badRequest("Invalid JSON body");
  }

  const name = body.name as string;
  if (!name || typeof name !== "string" || name.trim().length === 0) {
    return badRequest("name is required");
  }

  try {
    const workspace = await createWorkspace(name.trim(), session.user.id);
    return NextResponse.json({ data: workspace }, { status: 201 });
  } catch (err) {
    if (err instanceof Error && err.message === "ALREADY_HAS_WORKSPACE") {
      return NextResponse.json(
        {
          error: {
            code: "CONFLICT",
            message: "Account already has an organization",
          },
        },
        { status: 409 }
      );
    }
    console.error("Failed to create workspace:", err);
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: "Failed to create workspace" } },
      { status: 500 }
    );
  }
}
