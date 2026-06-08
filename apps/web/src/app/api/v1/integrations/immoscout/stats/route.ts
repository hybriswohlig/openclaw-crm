import { NextRequest } from "next/server";
import { getAuthContext, unauthorized, success } from "@/lib/api-utils";
import { db } from "@/db";
import { objects, attributes } from "@/db/schema/objects";
import { records, recordValues } from "@/db/schema/records";
import { eq, and } from "drizzle-orm";

interface ChannelStat {
  total: number;
  last30d: number;
  lastAt: string | null;
}

function emptyStat(): ChannelStat {
  return { total: 0, last30d: 0, lastAt: null };
}

/**
 * GET /api/v1/integrations/immoscout/stats
 *
 * Counts ImmoScout deals split by ingest channel (umzug-easy API vs IS24 email)
 * so the integrations page can show that leads are flowing even while the API
 * export is dry. Legacy deals without a `channel` field count as "api".
 */
export async function GET(req: NextRequest) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();

  const empty = { email: emptyStat(), api: emptyStat() };

  const [dealsObj] = await db
    .select({ id: objects.id })
    .from(objects)
    .where(and(eq(objects.workspaceId, ctx.workspaceId), eq(objects.slug, "deals")))
    .limit(1);
  if (!dealsObj) return success(empty);

  const [attr] = await db
    .select({ id: attributes.id })
    .from(attributes)
    .where(and(eq(attributes.objectId, dealsObj.id), eq(attributes.slug, "moving_lead_payload")))
    .limit(1);
  if (!attr) return success(empty);

  const rows = await db
    .select({ jsonValue: recordValues.jsonValue, createdAt: records.createdAt })
    .from(recordValues)
    .innerJoin(records, eq(records.id, recordValues.recordId))
    .where(and(eq(records.objectId, dealsObj.id), eq(recordValues.attributeId, attr.id)));

  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const stats: Record<"email" | "api", ChannelStat> = {
    email: emptyStat(),
    api: emptyStat(),
  };

  for (const row of rows) {
    const payload = row.jsonValue as Record<string, unknown> | null;
    if (!payload || String(payload.source ?? "") !== "immoscout24") continue;
    const channel = payload.channel === "email" ? "email" : "api";
    const s = stats[channel];
    s.total += 1;
    const created = row.createdAt ? new Date(row.createdAt).getTime() : 0;
    if (created >= cutoff) s.last30d += 1;
    if (row.createdAt && (!s.lastAt || created > new Date(s.lastAt).getTime())) {
      s.lastAt = new Date(row.createdAt).toISOString();
    }
  }

  return success(stats);
}
