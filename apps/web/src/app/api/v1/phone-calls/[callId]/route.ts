import { NextRequest } from "next/server";
import { anrufAntwortAus } from "@/lib/anrufe";
import { getAuthContext, notFound, success, unauthorized } from "@/lib/api-utils";
import { batchGetRecordDisplayNames } from "@/services/display-names";
import { getPhoneCall } from "@/services/phone-calls";

export const dynamic = "force-dynamic";

/**
 * GET → ein Anruf mit Transkript, gleiche Feldnamen wie die Liste
 * (`GET /api/v1/phone-calls`). Die neue Oberfläche lädt das Transkript erst
 * beim Öffnen des Dialogs. Nur im eigenen Workspace, sonst 404.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ callId: string }> }) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized(req);

  const { callId } = await params;
  const row = await getPhoneCall(ctx.workspaceId, callId);
  if (!row) return notFound("Anruf nicht gefunden.");

  const namen = row.personRecordId ? await batchGetRecordDisplayNames([row.personRecordId]) : null;
  const personName = row.personRecordId ? (namen?.get(row.personRecordId)?.displayName ?? null) : null;
  return success(anrufAntwortAus(row, personName || null));
}
