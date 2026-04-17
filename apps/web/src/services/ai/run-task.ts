/**
 * Single entry point for every AI call in the CRM.
 *
 * - Resolves per-task config from `ai_task_configs` (falls back to registry
 *   defaults and auto-seeds a row on first run).
 * - Reads the OpenRouter API key from workspace settings.
 * - Enforces a daily spend cap against `ai_task_runs`.
 * - Calls OpenRouter directly (no Vercel AI Gateway dependency).
 * - For structured output, uses JSON mode + schema in the prompt.
 * - Logs every invocation — success or failure — to `ai_task_runs`.
 * - Falls back to the configured `fallback_model` if the primary model throws.
 *
 * No feature module should call OpenRouter directly; everything routes here.
 */

import { type z, type ZodTypeAny } from "zod";
import { db } from "@/db";
import { aiTaskConfigs, aiTaskRuns, workspaces } from "@/db/schema";
import { and, eq, gte, sql } from "drizzle-orm";
import {
  AI_TASK_REGISTRY,
  type AITaskSlug,
  type AITaskDefinition,
} from "./task-registry";

const OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions";

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

/**
 * Resolve the OpenRouter API key from workspace settings.
 */
async function getOpenRouterApiKey(workspaceId: string): Promise<string | null> {
  const [ws] = await db
    .select({ settings: workspaces.settings })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId))
    .limit(1);
  const settings = (ws?.settings ?? {}) as { openrouterApiKey?: string };
  return settings.openrouterApiKey ?? null;
}

/**
 * Convert a Zod schema into a JSON Schema-ish description string
 * suitable for embedding in a prompt (no external dependency needed).
 */
function describeSchema(schema: ZodTypeAny): string {
  try {
    // Zod shapes can be walked manually for object schemas.
    const def = (schema as any)._def;
    if (def?.typeName === "ZodObject") {
      const shape = (schema as any).shape;
      const fields: string[] = [];
      for (const [key, val] of Object.entries(shape)) {
        const desc = (val as any)?._def?.description ?? (val as any)?.description ?? "";
        const typeName = (val as any)?._def?.typeName ?? "unknown";
        let typeLabel = "string";
        if (typeName === "ZodNullable") {
          const inner = (val as any)?._def?.innerType?._def?.typeName ?? "";
          if (inner === "ZodNumber") typeLabel = "number | null";
          else if (inner === "ZodArray") typeLabel = "array | null";
          else typeLabel = "string | null";
        } else if (typeName === "ZodNumber") typeLabel = "number";
        else if (typeName === "ZodBoolean") typeLabel = "boolean";
        else if (typeName === "ZodArray") typeLabel = "array";
        fields.push(`  "${key}": ${typeLabel}  // ${desc}`);
      }
      return `{\n${fields.join(",\n")}\n}`;
    }
  } catch { /* fallback */ }
  return "{}";
}

async function callModel<TSchema extends z.ZodTypeAny | undefined>(
  model: string,
  apiKey: string,
  input: RunAITaskInput<TSchema>,
  temperature: number | null,
  maxTokens: number | null
): Promise<{
  output: TSchema extends z.ZodTypeAny ? z.infer<TSchema> : string;
  inputTokens: number | null;
  outputTokens: number | null;
}> {
  const messages: Array<{ role: string; content: string }> = [
    { role: "system", content: input.system },
  ];

  let userPrompt = input.prompt;

  // For structured output, instruct the model to return JSON matching the schema.
  const useJsonMode = !!input.schema;
  if (input.schema) {
    const schemaDesc = describeSchema(input.schema);
    userPrompt += `\n\nIMPORTANT: Respond ONLY with valid JSON matching this schema (no markdown, no explanation):\n${schemaDesc}`;
  }

  messages.push({ role: "user", content: userPrompt });

  const body: Record<string, unknown> = {
    model,
    messages,
  };
  if (temperature != null) body.temperature = temperature;
  // Omit max_tokens entirely — let the model use its default limit.
  // Free-tier models on OpenRouter have restricted token budgets and
  // will reject requests that ask for more tokens than affordable.
  if (useJsonMode) {
    body.response_format = { type: "json_object" };
  }

  const res = await fetch(OPENROUTER_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": process.env.BETTER_AUTH_URL || "http://localhost:3001",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const msg = (err as any)?.error?.message ?? `OpenRouter HTTP ${res.status}`;
    throw new Error(msg);
  }

  const data = await res.json();
  const choice = data.choices?.[0];
  const content = choice?.message?.content ?? "";
  const usage = data.usage;

  if (input.schema) {
    // Parse JSON and validate with Zod.
    let parsed: unknown;
    try {
      // Strip markdown code fences if the model wraps the JSON.
      const cleaned = content.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
      parsed = JSON.parse(cleaned);
    } catch {
      throw new Error(`Failed to parse JSON from model response: ${content.slice(0, 200)}`);
    }
    const validated = input.schema.parse(parsed);
    return {
      output: validated,
      inputTokens: usage?.prompt_tokens ?? null,
      outputTokens: usage?.completion_tokens ?? null,
    };
  }

  return {
    output: content as TSchema extends z.ZodTypeAny ? z.infer<TSchema> : string,
    inputTokens: usage?.prompt_tokens ?? null,
    outputTokens: usage?.completion_tokens ?? null,
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

  // Resolve the OpenRouter API key from workspace settings.
  const apiKey = await getOpenRouterApiKey(input.workspaceId);
  if (!apiKey) {
    const runId = await logRun({
      workspaceId: input.workspaceId,
      taskSlug: input.taskSlug,
      provider: "openrouter",
      model: cfg.model,
      inputTokens: null,
      outputTokens: null,
      costUsd: null,
      latencyMs: 0,
      success: false,
      errorMessage: "no OpenRouter API key configured",
    });
    return {
      ok: false,
      runId,
      error: "Kein OpenRouter API Key konfiguriert. Bitte unter Einstellungen → AI Agent hinterlegen.",
    };
  }

  if (cfg.dailySpendCapUsd !== null) {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const spent = await getSpendSince(input.workspaceId, input.taskSlug, since);
    if (spent >= cfg.dailySpendCapUsd) {
      const runId = await logRun({
        workspaceId: input.workspaceId,
        taskSlug: input.taskSlug,
        provider: "openrouter",
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
      const result = await callModel(model, apiKey, input, cfg.temperature, cfg.maxTokens);
      const runId = await logRun({
        workspaceId: input.workspaceId,
        taskSlug: input.taskSlug,
        provider: "openrouter",
        model,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
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
    provider: "openrouter",
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
