import { NextRequest } from "next/server";
import { getAuthContext, success, unauthorized } from "@/lib/api-utils";
import { getCockpit } from "@/services/cockpit";

/**
 * GET /api/v1/inbox/cockpit
 *
 * Ein Aufruf für die Vorgangsliste in Hangar: alle offenen Lead-Konversationen
 * mit Deal, Deals ohne Chat, dazu Fakten, Preis, Anzahlung, wartender Entwurf,
 * letzte Nachrichten, Angebotsdatum und der Zustand der WhatsApp-Bridge.
 * Liest nur; markiert nichts als gelesen (anders als GET .../messages).
 *
 * Query: company (operating_company record id, optional), limit (1 bis 500, Vorgabe 200).
 */
export async function GET(req: NextRequest) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized(req);

  const { searchParams } = new URL(req.url);
  const company = searchParams.get("company")?.trim() || undefined;
  const limitParam = Number.parseInt(searchParams.get("limit") ?? "", 10);
  const limit = Number.isFinite(limitParam) ? Math.min(Math.max(limitParam, 1), 500) : undefined;

  const payload = await getCockpit(ctx.workspaceId, { company, limit });
  return success(payload);
}
