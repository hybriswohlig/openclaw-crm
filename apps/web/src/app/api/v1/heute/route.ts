import { NextRequest } from "next/server";
import { getAuthContext, success, unauthorized } from "@/lib/api-utils";
import { ladeHeute } from "@/services/heute";

/** GET → `{ data: HeuteAntwort }` (Plan 8, Entscheidung 11). Liest nur. */
export async function GET(req: NextRequest) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized(req);
  return success(await ladeHeute(ctx.workspaceId));
}
