import { NextRequest } from "next/server";
import { forbidden, getAuthContext, notFound, requireAdmin, success, unauthorized } from "@/lib/api-utils";
import { operatingCompanyInWorkspace } from "@/services/customer-portal-config";
import { ladeUebersicht } from "@/services/uebersicht";

export const dynamic = "force-dynamic";

/** GET `?firma=<ocId>` → `{ data: UebersichtAntwort }`. Nur Admins in der Sitzung. */
export async function GET(req: NextRequest) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized(req);
  if (ctx.authMethod !== "cookie") return forbidden("Nur in der angemeldeten Sitzung.");
  const denied = requireAdmin(ctx);
  if (denied) return denied;
  const firma = req.nextUrl.searchParams.get("firma") || null;
  if (firma && !(await operatingCompanyInWorkspace(ctx.workspaceId, firma))) {
    return notFound("Firma nicht gefunden.");
  }
  return success(await ladeUebersicht(ctx.workspaceId, firma));
}
