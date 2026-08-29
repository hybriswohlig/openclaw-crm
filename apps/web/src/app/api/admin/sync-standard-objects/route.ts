import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { isAdminEmail } from "@/lib/admin-auth";
import {
  getSingletonWorkspaceId,
  syncStandardObjectExtras,
} from "@/services/workspace";

/**
 * Admin-only backup trigger for the idempotent STANDARD_OBJECTS backfill.
 * Boot hook in `apps/web/src/instrumentation.ts` runs the same logic on every
 * server start; this endpoint is the manual escape hatch when ops want to
 * confirm the sync ran or pick up a hot constant change without a restart.
 */
export async function POST(req: NextRequest) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!isAdminEmail(session?.user?.email)) {
    return NextResponse.json(
      { error: { code: "FORBIDDEN", message: "Admin access required" } },
      { status: 403 }
    );
  }

  const workspaceId = await getSingletonWorkspaceId();
  if (!workspaceId) {
    return NextResponse.json(
      { error: { code: "NOT_FOUND", message: "No workspace found — run db:seed first" } },
      { status: 404 }
    );
  }

  try {
    const result = await syncStandardObjectExtras(workspaceId);
    return NextResponse.json({ data: { workspaceId, ...result } });
  } catch (e) {
    return NextResponse.json(
      {
        error: {
          code: "SYNC_FAILED",
          message: e instanceof Error ? e.message : String(e),
        },
      },
      { status: 500 }
    );
  }
}
