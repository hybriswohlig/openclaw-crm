import { NextRequest } from "next/server";
import { db } from "@/db";
import { aiTaskConfigs } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { success, forbidden, badRequest, notFound } from "@/lib/api-utils";
import { getAppAdminFromRequest } from "@/lib/require-app-admin";
import { getSingletonWorkspaceId } from "@/services/workspace";
import { getTaskDefinition } from "@/services/ai/task-registry";

interface PatchBody {
  provider?: string;
  model?: string;
  fallbackModel?: string | null;
  temperature?: number | null;
  maxTokens?: number | null;
  enabled?: boolean;
  dailySpendCapUsd?: number | null;
}

function sanitize(body: unknown): PatchBody | string {
  if (!body || typeof body !== "object") return "invalid body";
  const b = body as Record<string, unknown>;
  const out: PatchBody = {};
  if ("provider" in b) {
    if (typeof b.provider !== "string") return "provider must be a string";
    if (b.provider !== "gateway" && b.provider !== "openrouter")
      return "provider must be 'gateway' or 'openrouter'";
    out.provider = b.provider;
  }
  if ("model" in b) {
    if (typeof b.model !== "string" || !b.model.trim()) return "model must be a non-empty string";
    out.model = b.model.trim();
  }
  if ("fallbackModel" in b) {
    if (b.fallbackModel === null) out.fallbackModel = null;
    else if (typeof b.fallbackModel === "string") out.fallbackModel = b.fallbackModel.trim() || null;
    else return "fallbackModel must be a string or null";
  }
  if ("temperature" in b) {
    if (b.temperature === null) out.temperature = null;
    else if (typeof b.temperature === "number" && b.temperature >= 0 && b.temperature <= 2)
      out.temperature = b.temperature;
    else return "temperature must be a number between 0 and 2";
  }
  if ("maxTokens" in b) {
    if (b.maxTokens === null) out.maxTokens = null;
    else if (typeof b.maxTokens === "number" && b.maxTokens > 0 && Number.isInteger(b.maxTokens))
      out.maxTokens = b.maxTokens;
    else return "maxTokens must be a positive integer";
  }
  if ("enabled" in b) {
    if (typeof b.enabled !== "boolean") return "enabled must be a boolean";
    out.enabled = b.enabled;
  }
  if ("dailySpendCapUsd" in b) {
    if (b.dailySpendCapUsd === null) out.dailySpendCapUsd = null;
    else if (typeof b.dailySpendCapUsd === "number" && b.dailySpendCapUsd >= 0)
      out.dailySpendCapUsd = b.dailySpendCapUsd;
    else return "dailySpendCapUsd must be a non-negative number";
  }
  return out;
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ taskSlug: string }> }
) {
  const admin = await getAppAdminFromRequest(req);
  if (!admin) return forbidden("App admin access required");

  const workspaceId = await getSingletonWorkspaceId();
  if (!workspaceId) return forbidden("No singleton workspace configured");

  const { taskSlug } = await params;
  const def = getTaskDefinition(taskSlug);
  if (!def) return notFound(`Unknown AI task: ${taskSlug}`);

  const parsed = sanitize(await req.json().catch(() => null));
  if (typeof parsed === "string") return badRequest(parsed);

  const [existing] = await db
    .select()
    .from(aiTaskConfigs)
    .where(
      and(eq(aiTaskConfigs.workspaceId, workspaceId), eq(aiTaskConfigs.taskSlug, taskSlug))
    )
    .limit(1);

  const merged = {
    workspaceId,
    taskSlug,
    provider: parsed.provider ?? existing?.provider ?? def.defaultProvider,
    model: parsed.model ?? existing?.model ?? def.defaultModel,
    fallbackModel:
      "fallbackModel" in parsed ? parsed.fallbackModel : existing?.fallbackModel ?? def.defaultFallbackModel,
    temperature:
      "temperature" in parsed
        ? parsed.temperature !== null && parsed.temperature !== undefined
          ? String(parsed.temperature)
          : null
        : existing?.temperature ?? (def.defaultTemperature !== null ? String(def.defaultTemperature) : null),
    maxTokens:
      "maxTokens" in parsed ? parsed.maxTokens ?? null : existing?.maxTokens ?? def.defaultMaxTokens,
    enabled: parsed.enabled ?? existing?.enabled ?? true,
    dailySpendCapUsd:
      "dailySpendCapUsd" in parsed
        ? parsed.dailySpendCapUsd !== null && parsed.dailySpendCapUsd !== undefined
          ? String(parsed.dailySpendCapUsd)
          : null
        : existing?.dailySpendCapUsd ??
          (def.defaultDailySpendCapUsd !== null ? String(def.defaultDailySpendCapUsd) : null),
    updatedAt: new Date(),
  };

  await db
    .insert(aiTaskConfigs)
    .values(merged)
    .onConflictDoUpdate({
      target: [aiTaskConfigs.workspaceId, aiTaskConfigs.taskSlug],
      set: {
        provider: merged.provider,
        model: merged.model,
        fallbackModel: merged.fallbackModel,
        temperature: merged.temperature,
        maxTokens: merged.maxTokens,
        enabled: merged.enabled,
        dailySpendCapUsd: merged.dailySpendCapUsd,
        updatedAt: new Date(),
      },
    });

  return success({ ok: true });
}
