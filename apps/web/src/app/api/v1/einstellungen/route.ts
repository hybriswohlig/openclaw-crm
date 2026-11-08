/**
 * GET /api/v1/einstellungen (Plan 13): was die Seite Einstellungen zeigt.
 * Nur in der angemeldeten Sitzung (jeder API-Schlüssel 403). Firmen und
 * API-Schlüssel nur für Admins, sonst `null`. Geschrieben wird über die
 * vorhandenen Routen (Entscheidung 5).
 */
import { NextRequest } from "next/server";
import { forbidden, getAuthContext, success, unauthorized } from "@/lib/api-utils";
import { ladeEinstellungen } from "@/services/einstellungen";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized(req);
  if (ctx.authMethod !== "cookie") return forbidden("Nur in der angemeldeten Sitzung.");
  return success(
    await ladeEinstellungen({ workspaceId: ctx.workspaceId, userId: ctx.userId, workspaceRole: ctx.workspaceRole })
  );
}
