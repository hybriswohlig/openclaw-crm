import { NextRequest } from "next/server";
import {
  getAuthContext,
  unauthorized,
  success,
  badRequest,
  notFound,
  requireAdmin,
} from "@/lib/api-utils";
import { db } from "@/db";
import { aiTaskConfigs } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { getTaskDefinition } from "@/services/ai/task-registry";

export const dynamic = "force-dynamic";

/** PATCH — update per-workspace config for an AI task. Admin-only. */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ taskSlug: string }> }
) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();

  const adminCheck = requireAdmin(ctx);
  if (adminCheck) return adminCheck;

  const { taskSlug } = await params;

  // Validate the task slug exists in the registry.
  const def = getTaskDefinition(taskSlug);
  if (!def) return notFound(`Unknown AI task: ${taskSlug}`);

  const body = await req.json();
  const {
    enabled,
    model,
    fallbackModel,
    temperature,
    maxTokens,
    dailySpendCapUsd,
  } = body as {
    enabled?: boolean;
    model?: string;
    fallbackModel?: string | null;
    temperature?: number | null;
    maxTokens?: number | null;
    dailySpendCapUsd?: number | null;
  };

  if (
    enabled === undefined &&
    model === undefined &&
    fallbackModel === undefined &&
    temperature === undefined &&
    maxTokens === undefined &&
    dailySpendCapUsd === undefined
  ) {
    return badRequest("Provide at least one field to update");
  }

  // Upsert: if no row yet, seed from registry defaults then apply the patch.
  const [existing] = await db
    .select()
    .from(aiTaskConfigs)
    .where(
      and(
        eq(aiTaskConfigs.workspaceId, ctx.workspaceId),
        eq(aiTaskConfigs.taskSlug, taskSlug)
      )
    )
    .limit(1);

  const updates: Partial<typeof aiTaskConfigs.$inferInsert> = {
    updatedAt: new Date(),
  };
  if (enabled !== undefined) updates.enabled = enabled;
  if (model !== undefined) updates.model = model;
  if (fallbackModel !== undefined) updates.fallbackModel = fallbackModel;
  if (temperature !== undefined)
    updates.temperature = temperature !== null ? String(temperature) : null;
  if (maxTokens !== undefined) updates.maxTokens = maxTokens;
  if (dailySpendCapUsd !== undefined)
    updates.dailySpendCapUsd =
      dailySpendCapUsd !== null ? String(dailySpendCapUsd) : null;

  if (existing) {
    await db
      .update(aiTaskConfigs)
      .set(updates)
      .where(
        and(
          eq(aiTaskConfigs.workspaceId, ctx.workspaceId),
          eq(aiTaskConfigs.taskSlug, taskSlug)
        )
      );
  } else {
    // Seed from defaults, then apply overrides.
    await db.insert(aiTaskConfigs).values({
      workspaceId: ctx.workspaceId,
      taskSlug,
      provider: def.defaultProvider,
      model: model ?? def.defaultModel,
      fallbackModel:
        fallbackModel !== undefined ? fallbackModel : def.defaultFallbackModel,
      temperature:
        temperature !== undefined
          ? temperature !== null
            ? String(temperature)
            : null
          : def.defaultTemperature !== null
            ? String(def.defaultTemperature)
            : null,
      maxTokens: maxTokens ?? def.defaultMaxTokens,
      enabled: enabled ?? true,
      dailySpendCapUsd:
        dailySpendCapUsd !== undefined
          ? dailySpendCapUsd !== null
            ? String(dailySpendCapUsd)
            : null
          : def.defaultDailySpendCapUsd !== null
            ? String(def.defaultDailySpendCapUsd)
            : null,
      updatedAt: new Date(),
    });
  }

  return success({ taskSlug, updated: true });
}
