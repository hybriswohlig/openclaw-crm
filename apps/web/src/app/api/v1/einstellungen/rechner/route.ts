/**
 * GET /api/v1/einstellungen/rechner (Plan 13): Tarife, Stationen und Fahrzeuge
 * des Rechners, nur lesen. Nur Admins in der Sitzung (jeder API-Schlüssel 403).
 * Antwort nur die Ansichten des Vertrags (keine Margenregeln, Faktoren,
 * Koordinaten). Interne Sätze erscheinen nur hier, nie in MCP, Portal oder Agent.
 */
import { NextRequest } from "next/server";
import { forbidden, getAuthContext, requireAdmin, success, unauthorized } from "@/lib/api-utils";
import { ladeRechnerStammdaten } from "@/services/rechner/stammdaten";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized(req);
  if (ctx.authMethod !== "cookie") return forbidden("Nur in der angemeldeten Sitzung.");
  const denied = requireAdmin(ctx);
  if (denied) return denied;
  return success(await ladeRechnerStammdaten());
}
