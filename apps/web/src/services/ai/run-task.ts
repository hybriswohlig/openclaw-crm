/**
 * Single entry point for every AI call in the CRM.
 *
 * - Resolves per-task config from `ai_task_configs` (falls back to registry
 *   defaults and auto-seeds a row on first run).
 * - Routes by provider:
 *     - `openrouter` (default): direct HTTPS call, structured output via JSON mode
 *     - `crm-tools`: forwards the prompt to the crm-tools FastAPI service which
 *       runs Claude Code CLI server-side. Async (job_id + polling). Used so
 *       this workspace can opt into the Claude-Max plan for some tasks
 *       (typically background tasks like the daily insights refresh — UI
 *       interactivity suffers from the 30-90s latency).
 * - Enforces a daily spend cap against `ai_task_runs` (cap counts attempts;
 *   crm-tools path logs $0 since the cost is the Max-plan quota, not USD).
 * - Logs every invocation — success or failure — to `ai_task_runs`.
 * - Falls back to the configured `fallback_model` if the primary model throws
 *   (openrouter path only; crm-tools has a single Claude model).
 * - Post-processes plain-string outputs through the `humanizer-de` skill on
 *   crm-tools when the task definition sets `humanizeOutput: true`. Failures
 *   are swallowed (logged) — the original draft is returned rather than
 *   breaking the UI.
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

// crm-tools FastAPI provider (Claude-Code-CLI on the OCI server).
const CRM_TOOLS_API_URL = process.env.CRM_TOOLS_API_URL;
const CRM_TOOLS_AUTH_TOKEN = process.env.CRM_TOOLS_AUTH_TOKEN;
// Cap the polling so a hung skill can't keep a Vercel function alive forever.
const CRM_TOOLS_POLL_INTERVAL_MS = 3000;
// Poll budget must exceed the VPS skill timeout (we send 270s below) so we
// never abandon a job the VPS will still finish, while staying under the
// route's 300s function maxDuration so the function returns gracefully.
const CRM_TOOLS_POLL_MAX_MS = 290_000;
const CRM_TOOLS_MODEL_TAG = "claude-via-crm-tools";
// Humanizer runs as a second crm-tools job. Bound it separately so a slow
// humanization can't double the worst-case latency of the main task.
const HUMANIZER_POLL_MAX_MS = 90_000;

export const AI_PROVIDERS = ["openrouter", "crm-tools"] as const;
export type AIProvider = (typeof AI_PROVIDERS)[number];
export function isAIProvider(v: unknown): v is AIProvider {
  return typeof v === "string" && (AI_PROVIDERS as readonly string[]).includes(v);
}

export interface RunAITaskInput<TSchema extends z.ZodTypeAny | undefined = undefined> {
  workspaceId: string;
  taskSlug: AITaskSlug;
  system: string;
  prompt: string;
  schema?: TSchema;
  /**
   * Optional image attachments (base64) for multimodal tasks. Only the
   * `crm-tools` provider uses them: they are written into the Claude Code job's
   * working directory so `claude -p` can read them. Ignored by the (text-only)
   * OpenRouter path.
   */
  attachments?: Array<{ filename: string; mime: string; contentB64: string }>;
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
function scalarLabel(tn: string | undefined): string {
  if (tn === "ZodNumber") return "number";
  if (tn === "ZodBoolean") return "boolean";
  return "string";
}

/**
 * Produce a JSON-Schema-ish type label for a Zod type, RECURSING into nested
 * objects, arrays (including arrays of objects), and enums. Unwraps the
 * preprocess/default/optional/nullable wrappers our insight schema uses so the
 * model sees the real per-field types and the exact allowed enum values —
 * not a flat "string" for everything. (The previous version only walked the
 * top level, so `extracted` was described to the model as a bare "string".)
 */
function zodTypeLabel(schema: unknown, depth: number): string {
  let s: any = schema;
  let nullable = false;
  for (let i = 0; i < 10 && s?._def; i++) {
    const tn = s._def.typeName;
    if (tn === "ZodNullable") { nullable = true; s = s._def.innerType; continue; }
    if (tn === "ZodOptional" || tn === "ZodDefault") { s = s._def.innerType; continue; }
    if (tn === "ZodEffects") { s = s._def.schema; continue; }
    break;
  }
  const tn: string | undefined = s?._def?.typeName;
  let label: string;
  if (tn === "ZodObject" && depth < 5) {
    label = describeObject(s, depth + 1);
  } else if (tn === "ZodEnum") {
    const opts: string[] = s._def.values ?? [];
    label = opts.map((o) => JSON.stringify(o)).join(" | ") || "string";
  } else if (tn === "ZodArray") {
    const el = s._def.type;
    const elTn: string | undefined = el?._def?.typeName;
    if (elTn === "ZodObject" && depth < 5) label = `${describeObject(el, depth + 1)}[]`;
    else if (elTn === "ZodEnum") {
      const opts: string[] = el._def.values ?? [];
      label = `(${opts.map((o) => JSON.stringify(o)).join(" | ")})[]`;
    } else label = `${scalarLabel(elTn)}[]`;
  } else {
    label = scalarLabel(tn);
  }
  return nullable ? `${label} | null` : label;
}

function describeObject(schema: any, depth: number): string {
  const shape = (schema?.shape ?? {}) as Record<string, unknown>;
  const indent = "  ".repeat(depth);
  const closeIndent = "  ".repeat(Math.max(0, depth - 1));
  const fields: string[] = [];
  for (const [key, val] of Object.entries(shape)) {
    const desc =
      (val as any)?._def?.description ?? (val as any)?.description ?? "";
    const label = zodTypeLabel(val, depth);
    fields.push(`${indent}"${key}": ${label}${desc ? `  // ${desc}` : ""}`);
  }
  return `{\n${fields.join(",\n")}\n${closeIndent}}`;
}

function describeSchema(schema: ZodTypeAny): string {
  try {
    const label = zodTypeLabel(schema, 0);
    if (label.startsWith("{")) return label;
  } catch { /* fallback */ }
  return "{}";
}

/**
 * Pull the outermost JSON object out of a raw model response. Tolerates
 * markdown fences, a reasoning/preamble prefix, and trailing commentary by
 * slicing from the first `{` to the last `}`. Returns the original (trimmed,
 * de-fenced) text if no braces are found, so JSON.parse still throws a useful
 * error upstream.
 */
function extractJsonObject(raw: string): string {
  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  const first = cleaned.indexOf("{");
  const last = cleaned.lastIndexOf("}");
  if (first !== -1 && last !== -1 && last > first) {
    return cleaned.slice(first, last + 1);
  }
  return cleaned;
}

/** Unwrap ZodDefault/Optional/Nullable/Effects layers down to a ZodObject, or null. */
function unwrapToObject(schema: unknown): { shape: Record<string, ZodTypeAny> } | null {
  let s: any = schema;
  for (let i = 0; i < 8 && s?._def; i++) {
    const tn = s._def.typeName;
    if (tn === "ZodObject") return { shape: s.shape as Record<string, ZodTypeAny> };
    if (tn === "ZodDefault" || tn === "ZodOptional" || tn === "ZodNullable") {
      s = s._def.innerType;
      continue;
    }
    if (tn === "ZodEffects") {
      s = s._def.schema;
      continue;
    }
    break;
  }
  return null;
}

/**
 * Validate `parsed` against `schema`, but never throw away good data because of
 * one bad field. If a strict parse fails on an object schema, validate each
 * key independently (recursing into nested objects such as `extracted`),
 * keeping the keys that pass and falling back to each failing key's schema
 * default (null / [] for our insight fields). Returns the validated value plus
 * the list of dropped key paths, or ok:false if even per-key salvage can't
 * produce a schema-valid object.
 */
function tolerantParse<T extends ZodTypeAny>(
  schema: T,
  parsed: unknown
): { ok: true; data: z.infer<T>; dropped: string[] } | { ok: false; error: string } {
  const direct = schema.safeParse(parsed);
  if (direct.success) return { ok: true, data: direct.data, dropped: [] };

  const obj = unwrapToObject(schema);
  if (obj && parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    const src = parsed as Record<string, unknown>;
    const salvaged: Record<string, unknown> = {};
    const dropped: string[] = [];
    for (const [key, sub] of Object.entries(obj.shape)) {
      const r = sub.safeParse(src[key]);
      if (r.success) {
        salvaged[key] = r.data;
        continue;
      }
      const nested = tolerantParse(sub, src[key]);
      if (nested.ok) {
        salvaged[key] = nested.data;
        dropped.push(...nested.dropped.map((d) => `${key}.${d}`));
        continue;
      }
      const dflt = sub.safeParse(undefined);
      if (dflt.success) salvaged[key] = dflt.data;
      dropped.push(key);
    }
    const final = schema.safeParse(salvaged);
    if (final.success) return { ok: true, data: final.data, dropped };
  }

  return { ok: false, error: JSON.stringify(direct.error.issues).slice(0, 500) };
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
    // Parse JSON tolerantly (strip fences + slice the outermost object), then
    // salvage per-field so one bad field doesn't discard the whole extraction.
    let parsed: unknown;
    try {
      parsed = JSON.parse(extractJsonObject(content));
    } catch {
      throw new Error(`Failed to parse JSON from model response: ${content.slice(0, 200)}`);
    }
    const result = tolerantParse(input.schema, parsed);
    if (!result.ok) {
      throw new Error(`Schema validation failed: ${result.error}`);
    }
    if (result.dropped.length > 0) {
      console.warn(
        `[run-task] salvaged response, dropped ${result.dropped.length} invalid field(s): ${result.dropped.join(", ")}`
      );
    }
    return {
      output: result.data,
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

// ─── crm-tools provider ──────────────────────────────────────────────────────
//
// Forwards the prompt to /skills/ai-prompt on the crm-tools FastAPI, polls the
// resulting job_id, then parses + Zod-validates the response on this side.
// Schema description is built the same way as for OpenRouter (describeSchema)
// so the model gets identical guidance.

async function runViaCrmTools<TSchema extends z.ZodTypeAny | undefined>(
  input: RunAITaskInput<TSchema>,
  cfg: ResolvedConfig
): Promise<RunAITaskResult<TSchema>> {
  const started = Date.now();

  if (!CRM_TOOLS_API_URL || !CRM_TOOLS_AUTH_TOKEN) {
    const runId = await logRun({
      workspaceId: input.workspaceId,
      taskSlug: input.taskSlug,
      provider: "crm-tools",
      model: CRM_TOOLS_MODEL_TAG,
      inputTokens: null,
      outputTokens: null,
      costUsd: null,
      latencyMs: 0,
      success: false,
      errorMessage:
        "crm-tools env not configured (CRM_TOOLS_API_URL / CRM_TOOLS_AUTH_TOKEN)",
    });
    return {
      ok: false,
      runId,
      error: "crm-tools provider not configured. Set CRM_TOOLS_API_URL and CRM_TOOLS_AUTH_TOKEN in Vercel env.",
    };
  }

  if (cfg.dailySpendCapUsd !== null) {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const spent = await getSpendSince(input.workspaceId, input.taskSlug, since);
    if (spent >= cfg.dailySpendCapUsd) {
      const runId = await logRun({
        workspaceId: input.workspaceId,
        taskSlug: input.taskSlug,
        provider: "crm-tools",
        model: CRM_TOOLS_MODEL_TAG,
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

  // Build the user prompt with schema hint, matching the OpenRouter path.
  let userPrompt = input.prompt;
  if (input.schema) {
    const schemaDesc = describeSchema(input.schema);
    userPrompt = `${input.prompt}\n\nReturn a JSON object with this exact shape:\n${schemaDesc}`;
  }

  // 1) Start the job. Retry transient reachability failures (the historical
  //    `crm-tools start: fetch failed` errors are usually a brief VPS/network
  //    blip), with a short backoff between attempts.
  let jobId = "";
  let startError = "";
  const MAX_START_ATTEMPTS = 3;
  for (let attempt = 1; attempt <= MAX_START_ATTEMPTS && !jobId; attempt++) {
    try {
      const startResp = await fetch(`${CRM_TOOLS_API_URL}/skills/ai-prompt`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${CRM_TOOLS_AUTH_TOKEN}`,
        },
        body: JSON.stringify({
          params: {
            system_prompt: input.system,
            user_prompt: userPrompt,
            expect_json: !!input.schema,
            // Multimodal: the skill writes these into the job working dir so
            // `claude -p` can read the images. Omitted when there are none.
            attachments:
              input.attachments && input.attachments.length > 0 ? input.attachments : undefined,
            _workspace_id: input.workspaceId,
            _task_slug: input.taskSlug,
          },
          timeout_sec: 270,
        }),
      });
      if (!startResp.ok) {
        throw new Error(`HTTP ${startResp.status}: ${await startResp.text()}`);
      }
      const startData = (await startResp.json()) as { job_id?: string };
      if (!startData.job_id) throw new Error("no job_id in response");
      jobId = startData.job_id;
    } catch (err) {
      startError = err instanceof Error ? err.message : "start failed";
      if (attempt < MAX_START_ATTEMPTS) {
        await new Promise((r) => setTimeout(r, 1500 * attempt));
      }
    }
  }
  if (!jobId) {
    const errMsg = `${startError} (after ${MAX_START_ATTEMPTS} attempts)`;
    const runId = await logRun({
      workspaceId: input.workspaceId,
      taskSlug: input.taskSlug,
      provider: "crm-tools",
      model: CRM_TOOLS_MODEL_TAG,
      inputTokens: null,
      outputTokens: null,
      costUsd: null,
      latencyMs: Date.now() - started,
      success: false,
      errorMessage: `crm-tools start: ${errMsg}`,
    });
    return { ok: false, runId, error: `crm-tools start failed: ${errMsg}` };
  }

  // 2) Poll until done/error/timeout.
  const deadline = Date.now() + CRM_TOOLS_POLL_MAX_MS;
  let finalStatus: "done" | "error" | "timeout" = "timeout";
  let lastErrorMsg: string | null = null;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, CRM_TOOLS_POLL_INTERVAL_MS));
    try {
      const pollResp = await fetch(`${CRM_TOOLS_API_URL}/jobs/${jobId}`, {
        headers: { Authorization: `Bearer ${CRM_TOOLS_AUTH_TOKEN}` },
        cache: "no-store",
      });
      if (!pollResp.ok) {
        lastErrorMsg = `poll HTTP ${pollResp.status}`;
        continue;
      }
      const pollData = (await pollResp.json()) as {
        status: "queued" | "running" | "done" | "error";
        error?: string | null;
      };
      if (pollData.status === "done") {
        finalStatus = "done";
        break;
      }
      if (pollData.status === "error") {
        finalStatus = "error";
        lastErrorMsg = pollData.error ?? "skill error";
        break;
      }
    } catch (err) {
      lastErrorMsg = err instanceof Error ? err.message : "poll exception";
    }
  }

  if (finalStatus !== "done") {
    const errMsg =
      finalStatus === "timeout"
        ? `crm-tools job timed out after ${CRM_TOOLS_POLL_MAX_MS / 1000}s`
        : `crm-tools job error: ${lastErrorMsg ?? "unknown"}`;
    const runId = await logRun({
      workspaceId: input.workspaceId,
      taskSlug: input.taskSlug,
      provider: "crm-tools",
      model: CRM_TOOLS_MODEL_TAG,
      inputTokens: null,
      outputTokens: null,
      costUsd: null,
      latencyMs: Date.now() - started,
      success: false,
      errorMessage: errMsg,
    });
    return { ok: false, runId, error: errMsg };
  }

  // 3) Fetch result.
  let resultText: string;
  try {
    const resultResp = await fetch(`${CRM_TOOLS_API_URL}/jobs/${jobId}/result`, {
      headers: { Authorization: `Bearer ${CRM_TOOLS_AUTH_TOKEN}` },
    });
    if (!resultResp.ok) {
      throw new Error(`HTTP ${resultResp.status}`);
    }
    const resultPayload = (await resultResp.json()) as { text?: string };
    resultText = (resultPayload.text ?? "").trim();
    if (!resultText) throw new Error("empty result.text");
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : "result fetch failed";
    const runId = await logRun({
      workspaceId: input.workspaceId,
      taskSlug: input.taskSlug,
      provider: "crm-tools",
      model: CRM_TOOLS_MODEL_TAG,
      inputTokens: null,
      outputTokens: null,
      costUsd: null,
      latencyMs: Date.now() - started,
      success: false,
      errorMessage: `crm-tools result: ${errMsg}`,
    });
    return { ok: false, runId, error: `crm-tools result fetch failed: ${errMsg}` };
  }

  // 4) Parse JSON + Zod-validate if schema provided.
  let output: unknown;
  if (input.schema) {
    try {
      const parsed = JSON.parse(extractJsonObject(resultText));
      const tolerant = tolerantParse(input.schema, parsed);
      if (!tolerant.ok) {
        throw new Error(`Schema validation failed: ${tolerant.error}`);
      }
      if (tolerant.dropped.length > 0) {
        console.warn(
          `[run-task] crm-tools salvaged response, dropped ${tolerant.dropped.length} field(s): ${tolerant.dropped.join(", ")}`
        );
      }
      output = tolerant.data;
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : "JSON/schema parse failed";
      const runId = await logRun({
        workspaceId: input.workspaceId,
        taskSlug: input.taskSlug,
        provider: "crm-tools",
        model: CRM_TOOLS_MODEL_TAG,
        inputTokens: null,
        outputTokens: null,
        costUsd: null,
        latencyMs: Date.now() - started,
        success: false,
        errorMessage: `crm-tools parse: ${errMsg}. text head: ${resultText.slice(0, 200)}`,
      });
      return { ok: false, runId, error: `crm-tools response parse failed: ${errMsg}` };
    }
  } else {
    output = resultText;
  }

  const runId = await logRun({
    workspaceId: input.workspaceId,
    taskSlug: input.taskSlug,
    provider: "crm-tools",
    model: CRM_TOOLS_MODEL_TAG,
    inputTokens: null,
    outputTokens: null,
    costUsd: null,
    latencyMs: Date.now() - started,
    success: true,
    errorMessage: null,
  });
  return {
    ok: true,
    runId,
    model: CRM_TOOLS_MODEL_TAG,
    output: output as TSchema extends z.ZodTypeAny ? z.infer<TSchema> : string,
  };
}

// ─── Humanizer (crm-tools /skills/humanizer-de) ──────────────────────────────
//
// Best-effort: returns the humanized text or `null` if anything goes wrong
// (env missing, job timeout, parse error). Caller falls back to the original
// draft on null — humanization must never block the user-facing reply.

async function humanizeViaCrmTools(text: string): Promise<string | null> {
  if (!CRM_TOOLS_API_URL || !CRM_TOOLS_AUTH_TOKEN) {
    console.warn("[humanizer] crm-tools env not configured; skipping");
    return null;
  }

  try {
    const startResp = await fetch(`${CRM_TOOLS_API_URL}/skills/humanizer-de`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${CRM_TOOLS_AUTH_TOKEN}`,
      },
      body: JSON.stringify({
        params: { text, _task_slug: "humanizer-de" },
        timeout_sec: 120,
      }),
    });
    if (!startResp.ok) {
      console.warn(`[humanizer] start HTTP ${startResp.status}`);
      return null;
    }
    const { job_id: jobId } = (await startResp.json()) as { job_id?: string };
    if (!jobId) {
      console.warn("[humanizer] no job_id in start response");
      return null;
    }

    const deadline = Date.now() + HUMANIZER_POLL_MAX_MS;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, CRM_TOOLS_POLL_INTERVAL_MS));
      const pollResp = await fetch(`${CRM_TOOLS_API_URL}/jobs/${jobId}`, {
        headers: { Authorization: `Bearer ${CRM_TOOLS_AUTH_TOKEN}` },
        cache: "no-store",
      });
      if (!pollResp.ok) continue;
      const { status, error } = (await pollResp.json()) as {
        status: "queued" | "running" | "done" | "error";
        error?: string | null;
      };
      if (status === "done") break;
      if (status === "error") {
        console.warn(`[humanizer] skill error: ${error ?? "unknown"}`);
        return null;
      }
      if (Date.now() >= deadline) {
        console.warn(`[humanizer] timeout after ${HUMANIZER_POLL_MAX_MS / 1000}s`);
        return null;
      }
    }

    const resultResp = await fetch(`${CRM_TOOLS_API_URL}/jobs/${jobId}/result`, {
      headers: { Authorization: `Bearer ${CRM_TOOLS_AUTH_TOKEN}` },
    });
    if (!resultResp.ok) {
      console.warn(`[humanizer] result HTTP ${resultResp.status}`);
      return null;
    }
    const { text: humanized } = (await resultResp.json()) as { text?: string };
    const trimmed = (humanized ?? "").trim();
    return trimmed.length > 0 ? trimmed : null;
  } catch (err) {
    console.warn("[humanizer] unexpected error:", err);
    return null;
  }
}

/**
 * If the task is flagged `humanizeOutput` and the result is a plain string,
 * pipe it through the humanizer skill. Errors return the original draft.
 */
async function maybeHumanize<TSchema extends z.ZodTypeAny | undefined>(
  def: AITaskDefinition,
  input: RunAITaskInput<TSchema>,
  result: RunAITaskResult<TSchema>
): Promise<RunAITaskResult<TSchema>> {
  if (!def.humanizeOutput) return result;
  if (!result.ok) return result;
  if (input.schema) return result; // structured outputs are not customer text
  if (typeof result.output !== "string") return result;

  const humanized = await humanizeViaCrmTools(result.output);
  if (humanized === null) return result;
  return {
    ...result,
    output: humanized as TSchema extends z.ZodTypeAny ? z.infer<TSchema> : string,
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

  // Branch on provider. crm-tools is opt-in per task; default stays openrouter.
  if (cfg.provider === "crm-tools") {
    const result = await runViaCrmTools(input, cfg);
    return maybeHumanize(def, input, result);
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
      return maybeHumanize(def, input, {
        ok: true,
        runId,
        model,
        output: result.output,
      });
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
