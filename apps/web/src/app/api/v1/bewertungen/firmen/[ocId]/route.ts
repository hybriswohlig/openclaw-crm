/**
 * PUT /api/v1/bewertungen/firmen/[ocId] { modus?, hakenPortal? }
 * Nur Admins in der Sitzung. EINGABE 400, fremde Firma 404.
 */
import { NextRequest } from "next/server";
import { badRequest, forbidden, getAuthContext, notFound, requireAdmin, success, unauthorized } from "@/lib/api-utils";
import { BewertungModusFehler, bewertungModusSetzen, ladeBewertungModus } from "@/services/bewertung-modus";

export const dynamic = "force-dynamic";

export async function PUT(req: NextRequest, { params }: { params: Promise<{ ocId: string }> }) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized(req);
  if (ctx.authMethod !== "cookie") return forbidden("Nur in der angemeldeten Sitzung.");
  const denied = requireAdmin(ctx);
  if (denied) return denied;

  const { ocId } = await params;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest("Invalid JSON body");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) return badRequest("Ungültige Eingabe.");

  const eingabe = body as { modus?: unknown; hakenPortal?: unknown };
  const patch: { modus?: typeof eingabe.modus; hakenPortal?: typeof eingabe.hakenPortal } = {};
  if ("modus" in eingabe) patch.modus = eingabe.modus;
  if ("hakenPortal" in eingabe) patch.hakenPortal = eingabe.hakenPortal;

  try {
    await bewertungModusSetzen(
      ctx.workspaceId,
      ocId,
      patch as { modus?: "aus" | "entwurf" | "senden"; hakenPortal?: boolean },
      ctx.userId
    );
  } catch (e) {
    if (e instanceof BewertungModusFehler) {
      if (e.code === "FIRMA") return notFound(e.message);
      return badRequest(e.message);
    }
    throw e;
  }

  const stand = await ladeBewertungModus(ctx.workspaceId, ocId);
  return success({
    modus: stand.modus,
    seit: stand.seit ? stand.seit.toISOString() : null,
    hakenPortal: stand.hakenPortal,
  });
}
