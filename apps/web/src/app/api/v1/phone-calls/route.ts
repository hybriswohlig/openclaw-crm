import { NextRequest } from "next/server";
import { getAuthContext, success, unauthorized } from "@/lib/api-utils";
import { kontextFuerAnrufe } from "@/services/phone-call-lead";
import { listRecentPhoneCalls } from "@/services/phone-calls";

export const dynamic = "force-dynamic";

/** Latest calls for the staff list. Session required. No public access. */
export async function GET(req: NextRequest) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized(req);

  const limit = Math.min(Number(req.nextUrl.searchParams.get("limit") ?? 40), 50);
  const safeLimit = Number.isFinite(limit) && limit > 0 ? limit : 40;
  const rows = await listRecentPhoneCalls(ctx.workspaceId, safeLimit);
  const hinweise = await kontextFuerAnrufe(ctx.workspaceId, rows);

  return success(
    rows.map((row) => {
      const hinweis = hinweise.get(row.id) ?? { karten: [], bestehendePerson: null, offeneLeads: [] };
      return {
        id: row.id,
        callerE164: row.callerE164,
        callerRaw: row.callerRaw,
        calledE164: row.calledE164,
        lineLabel: row.lineLabel,
        answeredBy: row.answeredBy,
        startedAt: row.startedAt.toISOString(),
        durationSeconds: row.durationSeconds,
        summary: row.summary,
        transcript: row.transcript,
        keywords: row.keywords ?? [],
        personRecordId: row.personRecordId,
        dealRecordId: row.dealRecordId,
        matchStatus: row.matchStatus,
        karten: hinweis.karten,
        bestehendePerson: hinweis.bestehendePerson,
        offeneLeads: hinweis.offeneLeads,
      };
    })
  );
}
