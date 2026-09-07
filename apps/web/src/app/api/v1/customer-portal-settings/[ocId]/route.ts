/**
 * GET  /api/v1/customer-portal-settings/[ocId] — load one OC's settings.
 * PUT  /api/v1/customer-portal-settings/[ocId] — patch one OC's settings.
 *
 * Admin-only.
 */
import { NextRequest } from "next/server";
import {
  getAuthContext,
  requireAdmin,
  unauthorized,
  notFound,
  success,
  badRequest,
} from "@/lib/api-utils";
import {
  getOperatingCompanyPortalSettings,
  upsertOperatingCompanyPortalSettings,
  type PortalSettingsUpdate,
} from "@/services/customer-portal-config";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ ocId: string }> }
) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();
  const denied = requireAdmin(ctx);
  if (denied) return denied;

  const { ocId } = await params;
  const data = await getOperatingCompanyPortalSettings(ctx.workspaceId, ocId);
  if (!data) return notFound();
  return success(data);
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ ocId: string }> }
) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();
  const denied = requireAdmin(ctx);
  if (denied) return denied;

  const { ocId } = await params;
  let body: PortalSettingsUpdate;
  try {
    body = (await req.json()) as PortalSettingsUpdate;
  } catch {
    return badRequest("Invalid JSON body");
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) return badRequest("Ungültige Einstellungen.");
  for (const key of ["enabled", "liveTrackingEnabled", "paymentsEnabled"] as const) {
    if (key in body && typeof body[key] !== "boolean") return badRequest(`${key} muss ein Boolean sein.`);
  }

  // Lightweight validation: a domain must look like a hostname.
  if (body.customDomain != null && body.customDomain !== "") {
    const d = body.customDomain.toLowerCase();
    if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(d)) {
      return badRequest("Ungültige Domain. Beispiel: status.kottke-umzuege.de");
    }
  }
  if (body.primaryColor != null && body.primaryColor !== "") {
    const c = body.primaryColor.replace(/^#/, "");
    if (!/^[0-9a-fA-F]{6}$/.test(c)) {
      return badRequest("Ungültige Farbe. Bitte 6-stelliger Hex (z. B. 1f3a5f).");
    }
  }
  if (body.whatsappNumberE164 != null && body.whatsappNumberE164 !== "") {
    if (!/^\+?\d{6,20}$/.test(body.whatsappNumberE164.replace(/\s/g, ""))) {
      return badRequest("Ungültige WhatsApp-Nummer (E.164 erwartet).");
    }
  }

  const updated = await upsertOperatingCompanyPortalSettings(
    ctx.workspaceId,
    ocId,
    body
  );
  if (!updated) return notFound();
  return success(updated);
}
