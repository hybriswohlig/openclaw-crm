import { NextRequest } from "next/server";
import { getAuthContext, unauthorized, success } from "@/lib/api-utils";
import { db } from "@/db";
import { aiTaskConfigs } from "@/db/schema";
import { eq } from "drizzle-orm";
import { listTaskDefinitions } from "@/services/ai/task-registry";

export const dynamic = "force-dynamic";

/** GET — list all registered AI tasks with per-workspace config overrides. */
export async function GET(req: NextRequest) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();

  const definitions = listTaskDefinitions();

  // Fetch any per-workspace overrides.
  const overrides = await db
    .select()
    .from(aiTaskConfigs)
    .where(eq(aiTaskConfigs.workspaceId, ctx.workspaceId));

  const overrideMap = new Map(overrides.map((o) => [o.taskSlug, o]));

  const tasks = definitions.map((def) => {
    const o = overrideMap.get(def.slug);
    return {
      slug: def.slug,
      label: def.label,
      description: def.description,
      // Effective config (override or default).
      provider: o?.provider ?? def.defaultProvider,
      model: o?.model ?? def.defaultModel,
      fallbackModel: o?.fallbackModel ?? def.defaultFallbackModel,
      temperature: o?.temperature !== undefined && o?.temperature !== null
        ? Number(o.temperature)
        : def.defaultTemperature,
      maxTokens: o?.maxTokens ?? def.defaultMaxTokens,
      enabled: o?.enabled ?? true,
      dailySpendCapUsd: o?.dailySpendCapUsd !== undefined && o?.dailySpendCapUsd !== null
        ? Number(o.dailySpendCapUsd)
        : def.defaultDailySpendCapUsd,
      hasOverride: !!o,
    };
  });

  return success(tasks);
}
