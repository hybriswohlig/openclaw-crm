import { NextRequest } from "next/server";
import { success, forbidden, notFound, badRequest, conflict } from "@/lib/api-utils";
import { getAppAdminFromRequest } from "@/lib/require-app-admin";
import { LetzterAdminError, rejectUser } from "@/services/workspace";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  const admin = await getAppAdminFromRequest(req);
  if (!admin) {
    return forbidden("App admin access required");
  }

  const { userId } = await params;
  if (userId === admin.userId) {
    return badRequest("Cannot reject your own account");
  }

  try {
    // Gleicher Ablauf wie „Mitglied entfernen“: Freigabe, Sitzungen, Push-Abos,
    // Mitgliedschaften und API-Schlüssel in einer Transaktion. Den letzten
    // Admin eines Workspace und den letzten App-Admin lehnt rejectUser mit 409
    // ab, auch wenn der ablehnende App-Admin im Team nur Mitglied ist.
    const rejected = await rejectUser(userId);
    if (!rejected) {
      return notFound("User not found");
    }
    return success(rejected);
  } catch (e: unknown) {
    if (e instanceof LetzterAdminError) return conflict(e.message);
    throw e;
  }
}
