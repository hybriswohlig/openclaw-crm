import { NextRequest } from "next/server";
import { anrufAntwortAus } from "@/lib/anrufe";
import { getAuthContext, success, unauthorized } from "@/lib/api-utils";
import { batchGetRecordDisplayNames } from "@/services/display-names";
import { kontextFuerAnrufe } from "@/services/phone-call-lead";
import { listRecentPhoneCalls } from "@/services/phone-calls";

export const dynamic = "force-dynamic";

/**
 * Latest calls for the staff list. Session required. No public access.
 * Feldnamen wie `GET /phone-calls/[callId]` (`anrufAntwortAus`), dazu die
 * Hinweise für die Lead-Zuordnung.
 */
export async function GET(req: NextRequest) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized(req);

  const limit = Math.min(Number(req.nextUrl.searchParams.get("limit") ?? 40), 50);
  const safeLimit = Number.isFinite(limit) && limit > 0 ? limit : 40;
  const rows = await listRecentPhoneCalls(ctx.workspaceId, safeLimit);
  const [hinweise, namen] = await Promise.all([
    kontextFuerAnrufe(ctx.workspaceId, rows),
    batchGetRecordDisplayNames(rows.flatMap((row) => (row.personRecordId ? [row.personRecordId] : []))),
  ]);

  return success(
    rows.map((row) => {
      const hinweis = hinweise.get(row.id) ?? { karten: [], bestehendePerson: null, offeneLeads: [] };
      const personName = row.personRecordId ? (namen.get(row.personRecordId)?.displayName ?? null) : null;
      return {
        ...anrufAntwortAus(row, personName || null),
        karten: hinweis.karten,
        bestehendePerson: hinweis.bestehendePerson,
        offeneLeads: hinweis.offeneLeads,
      };
    })
  );
}
