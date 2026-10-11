import { NextRequest } from "next/server";
import { success, forbidden, notFound } from "@/lib/api-utils";
import { getAppAdminFromRequest } from "@/lib/require-app-admin";
import { approveUser } from "@/services/workspace";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  const admin = await getAppAdminFromRequest(req);
  if (!admin) {
    return forbidden("App admin access required");
  }

  const { userId } = await params;

  // Neue Registrierungen und gesperrte Konten („Wieder freigeben“) gleich:
  // Nach der nächsten Anmeldung legt getAuthContext die Mitgliedschaft an.
  const approved = await approveUser(userId);
  if (!approved) {
    return notFound("User not found");
  }

  return success(approved);
}
