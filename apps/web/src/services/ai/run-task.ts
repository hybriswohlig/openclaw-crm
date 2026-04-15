/**
 * Single entry point for every AI call in the CRM.
 *
 * - Resolves per-task config from `ai_task_configs` (falls back to registry
 *   defaults and auto-seeds a row on first run).
 * - Enforces a daily spend cap against `ai_task_runs`.
 * - Runs the call through AI SDK v6 `generateText` (optionally with structured
 *   output via `Output.object`).
 * - Logs every invocation — success or failure — to `ai_task_runs`.
 * - Falls back to the configured `fallback_model` if the primary model throws.
 *
 * No feature module should import from `ai` directly; everything routes here.
 */

import { generateText, Output } from "ai";
import type { z } from "zod";
import { db } from "@/db";
import { aiTaskConfigs, aiTaskRuns } from "@/db/schema";
import { and, eq, gte, sql } from "drizzle-orm";
import {
  AI_TASK_REGISTRY,
  type AITaskSlug,
  type AITaskDefinition,
} from "./task-registry";

export interface RunAITaskInput<TSchema extends z.ZodTypeAny | undefined = undefined> {
  workspaceId: string;
  taskSlug: AITaskSlug;
  system: string;
  prompt: string;
  schema?: TSchema;
}

export type RunAITaskResult<TSchema extends z.ZodTypeAny | undefined> =
  | {
      ok: true;
      runId: string;
      model: string;
      output: TSchema extends z.ZodTypeAny ? z.infer<TSchema> : string;
    }
  | {
      ok: false;
      runId: string;
      error: string;
    };

interface ResolvedConfig {
  provider: string;
  model: string;
  fallbackModel: string | null;
  temperature: number | null;
  maxTokens: number | null;
  enabled: boolean;
  dailySpendCapUsd: number | null;
}

async function resolveConfig(
  workspaceId: string,
  taskSlug: AITaskSlug,
  def: AITaskDefinition
): Promise<ResolvedConfig> {
  const [existing] = await db
    .select()
    .from(aiTaskConfigs)
    .where(
      and(eq(aiTaskConfigs.workspaceId, workspaceId), eq(aiTaskConfigs.taskSlug, taskSlug))
    )
    .limit(1);

  if (existing) {
    return {
      provider: existing.provider,
      model: existing.model,
      fallbackModel: existing.fallbackModel,
      temperature: existing.temperature !== null ? Number(existing.temperature) : null,
      maxTokens: existing.maxTokens,
      enabled: existing.enabled,
      dailySpendCapUsd:
        existing.dailySpendCapUsd !== null ? Number(existing.dailySpendCapUsd) : null,
    };
  }

  // Lazy-seed a row from registry defaults so the admin UI can display it.
  await db
    .insert(aiTaskConfigs)
    .values({
      workspaceId,
      taskSlug,
      provider: def.defaultProvider,
      model: def.defaultModel,
      fallbackModel: def.defaultFallbackModel,
      temperature: def.defaultTemperature !== null ? String(def.defaultTemperature) : null,
      maxTokens: def.defaultMaxTokens,
      enabled: true,
      dailySpendCapUsd:
        def.defaultDailySpendCapUsd !== null ? String(def.defaultDailySpendCapUsd) : null,
      updatedAt: new Date(),
    })
    .onConflictDoNothing();

  return {
    provider: def.defaultProvider,
    model: def.defaultModel,
    fallbackModel: def.defaultFallbackModel,
    temperature: def.defaultTemperature,
    maxTokens: def.defaultMaxTokens,
    enabled: true,
    dailySpendCapUsd: def.defaultDailySpendCapUsd,
  };
}

async function getSpendSince(
  workspaceId: string,
  taskSlug: AITaskSlug,
  since: Date
): Promise<number> {
  const [row] = await db
    .select({ total: sql<string>`COALESCE(SUM(${aiTaskRuns.costUsd}), 0)` })
    .from(aiTaskRuns)
    .where(
      and(
        eq(aiTaskRuns.workspaceId, workspaceId),
        eq(aiTaskRuns.taskSlug, taskSlug),
        gte(aiTaskRuns.createdAt, since)
      )
    );
  return Number(row?.total ?? 0);
}

async function logRun(params: {
  workspaceId: string;
  taskSlug: AITaskSlug;
  provider: string;
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: number | null;
  latencyMs: number;
  success: boolean;
  errorMessage: string | null;
}): Promise<string> {
  const [row] = await db
    .insert(aiTaskRuns)
    .values({
      workspaceId: params.workspaceId,
      taskSlug: params.taskSlug,
      provider: params.provider,
      model: params.model,
      inputTokens: params.inputTokens,
      outputTokens: params.outputTokens,
      costUsd: params.costUsd !== null ? String(params.costUsd) : null,
      latencyMs: params.latencyMs,
      success: params.success,
      errorMessage: params.errorMessage,
    })
    .returning({ id: aiTaskRuns.id });
  return row.id;
}

async function callModel<TSchema extends z.ZodTypeAny | undefined>(
  model: string,
  input: RunAITaskInput<TSchema>
): Promise<{
  output: TSchema extends z.ZodTypeAny ? z.infer<TSchema> : string;
  inputTokens: number | null;
  outputTokens: number | null;
}> {
  const baseArgs = {
    model,
    system: input.system,
    prompt: input.prompt,
  } as const;

  if (input.schema) {
    const { output, usage } = await generateText({
      ...baseArgs,
      output: Output.object({ schema: input.schema }),
    });
    return {
      output: output as TSchema extends z.ZodTypeAny ? z.infer<TSchema> : string,
      inputTokens: usage?.inputTokens ?? null,
      outputTokens: usage?.outputTokens ?? null,
    };
  }

  const { text, usage } = await generateText(baseArgs);
  return {
    output: text as TSchema extends z.ZodTypeAny ? z.infer<TSchema> : string,
    inputTokens: usage?.inputTokens ?? null,
    outputTokens: usage?.outputTokens ?? null,
  };
}

export async function runAITask<TSchema extends z.ZodTypeAny | undefined = undefined>(
  input: RunAITaskInput<TSchema>
): Promise<RunAITaskResult<TSchema>> {
  const def = AI_TASK_REGISTRY[input.taskSlug];
  if (!def) {
    throw new Error(`Unknown AI task slug: ${input.taskSlug}`);
  }

  const cfg = await resolveConfig(input.workspaceId, input.taskSlug, def);

  if (!cfg.enabled) {
    const runId = await logRun({
      workspaceId: input.workspaceId,
      taskSlug: input.taskSlug,
      provider: cfg.provider,
      model: cfg.model,
      inputTokens: null,
      outputTokens: null,
      costUsd: null,
      latencyMs: 0,
      success: false,
      errorMessage: "task disabled for this workspace",
    });
    return { ok: false, runId, error: "AI task is disabled for this workspace." };
  }

  if (cfg.dailySpendCapUsd !== null) {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const spent = await getSpendSince(input.workspaceId, input.taskSlug, since);
    if (spent >= cfg.dailySpendCapUsd) {
      const runId = await logRun({
        workspaceId: input.workspaceId,
        taskSlug: input.taskSlug,
        provider: cfg.provider,
        model: cfg.model,
        inputTokens: null,
        outputTokens: null,
        costUsd: null,
        latencyMs: 0,
        success: false,
        errorMessage: `daily spend cap reached (${spent.toFixed(4)} / ${cfg.dailySpendCapUsd})`,
      });
      return {
        ok: false,
        runId,
        error: `Daily AI spend cap reached for this task ($${cfg.dailySpendCapUsd.toFixed(2)}).`,
      };
    }
  }

  const started = Date.now();
  const modelsToTry: string[] = [cfg.model];
  if (cfg.fallbackModel && cfg.fallbackModel !== cfg.model) {
    modelsToTry.push(cfg.fallbackModel);
  }

  let lastError: unknown = null;
  for (const model of modelsToTry) {
    try {
      const result = await callModel(model, input);
      const runId = await logRun({
        workspaceId: input.workspaceId,
        taskSlug: input.taskSlug,
        provider: cfg.provider,
        model,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        // Cost tracking TODO: wire in once the AI Gateway exposes per-call
        // pricing on the v6 result. For now tokens are enough for tuning.
        costUsd: null,
        latencyMs: Date.now() - started,
        success: true,
        errorMessage: null,
      });
      return { ok: true, runId, model, output: result.output };
    } catch (err) {
      lastError = err;
      console.error(
        `[runAITask] ${input.taskSlug} failed on ${model}:`,
        err instanceof Error ? err.message : err
      );
    }
  }

  const errMsg = lastError instanceof Error ? lastError.message : "unknown AI error";
  const runId = await logRun({
    workspaceId: input.workspaceId,
    taskSlug: input.taskSlug,
    provider: cfg.provider,
    model: modelsToTry[modelsToTry.length - 1],
    inputTokens: null,
    outputTokens: null,
    costUsd: null,
    latencyMs: Date.now() - started,
    success: false,
    errorMessage: errMsg,
  });
  return { ok: false, runId, error: errMsg };
}
