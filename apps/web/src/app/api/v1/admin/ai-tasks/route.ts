import { NextRequest } from "next/server";
import { db } from "@/db";
import { aiTaskConfigs, aiTaskRuns } from "@/db/schema";
import { and, eq, gte, sql } from "drizzle-orm";
import { success, forbidden } from "@/lib/api-utils";
import { getAppAdminFromRequest } from "@/lib/require-app-admin";
import { getSingletonWorkspaceId } from "@/services/workspace";
import { listTaskDefinitions } from "@/services/ai/task-registry";

export async function GET(req: NextRequest) {
  const admin = await getAppAdminFromRequest(req);
  if (!admin) return forbidden("App admin access required");

  const workspaceId = await getSingletonWorkspaceId();
  if (!workspaceId) return forbidden("No singleton workspace configured");

  const defs = listTaskDefinitions();
  const configs = await db
    .select()
    .from(aiTaskConfigs)
    .where(eq(aiTaskConfigs.workspaceId, workspaceId));

  const configBySlug = new Map(configs.map((c) => [c.taskSlug, c]));

  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const totals = await db
    .select({
      taskSlug: aiTaskRuns.taskSlug,
      totalCostUsd: sql<string>`COALESCE(SUM(${aiTaskRuns.costUsd}), 0)`,
      totalInputTokens: sql<string>`COALESCE(SUM(${aiTaskRuns.inputTokens}), 0)`,
      totalOutputTokens: sql<string>`COALESCE(SUM(${aiTaskRuns.outputTokens}), 0)`,
      runCount: sql<string>`COUNT(*)`,
      failureCount: sql<string>`COUNT(*) FILTER (WHERE ${aiTaskRuns.success} = false)`,
    })
    .from(aiTaskRuns)
    .where(
      and(
        eq(aiTaskRuns.workspaceId, workspaceId),
        gte(aiTaskRuns.createdAt, since)
      )
    )
    .groupBy(aiTaskRuns.taskSlug);

  const totalsBySlug = new Map(totals.map((t) => [t.taskSlug, t]));

  const rows = defs.map((def) => {
    const cfg = configBySlug.get(def.slug);
    const totals7d = totalsBySlug.get(def.slug);
    return {
      slug: def.slug,
      label: def.label,
      description: def.description,
      provider: cfg?.provider ?? def.defaultProvider,
      model: cfg?.model ?? def.defaultModel,
      fallbackModel: cfg?.fallbackModel ?? def.defaultFallbackModel,
      temperature:
        cfg?.temperature !== undefined && cfg?.temperature !== null
          ? Number(cfg.temperature)
          : def.defaultTemperature,
      maxTokens: cfg?.maxTokens ?? def.defaultMaxTokens,
      enabled: cfg?.enabled ?? true,
      dailySpendCapUsd:
        cfg?.dailySpendCapUsd !== undefined && cfg?.dailySpendCapUsd !== null
          ? Number(cfg.dailySpendCapUsd)
          : def.defaultDailySpendCapUsd,
      configured: !!cfg,
      last7d: {
        runs: Number(totals7d?.runCount ?? 0),
        failures: Number(totals7d?.failureCount ?? 0),
        inputTokens: Number(totals7d?.totalInputTokens ?? 0),
        outputTokens: Number(totals7d?.totalOutputTokens ?? 0),
        costUsd: Number(totals7d?.totalCostUsd ?? 0),
      },
    };
  });

  return success({ tasks: rows });
}
