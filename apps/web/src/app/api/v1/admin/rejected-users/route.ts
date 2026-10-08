import { NextRequest } from "next/server";
import { success, forbidden } from "@/lib/api-utils";
import { getAppAdminFromRequest } from "@/lib/require-app-admin";
import { listRejectedUsers } from "@/services/workspace";

/**
 * Gesperrte Konten für den Bereich „Gesperrt“ unter Benutzer-Freigaben:
 * abgelehnte Registrierungen und aus dem Team entfernte Mitglieder.
 * Wieder freigegeben werden sie über POST /api/v1/admin/users/:id/approve.
 */
export async function GET(req: NextRequest) {
  const admin = await getAppAdminFromRequest(req);
  if (!admin) {
    return forbidden("App admin access required");
  }

  return success(await listRejectedUsers());
}
