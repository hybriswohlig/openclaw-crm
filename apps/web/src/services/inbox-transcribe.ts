/**
 * Voice-note transcription worker (Phase 0 of the agent rebuild).
 *
 * Owner decision: WhatsApp Sprachnachrichten MUST be transcribed so the sales
 * agent reads voice answers like text (never re-asks what a customer already
 * answered by voice note). Runs on the /api/cron/transcribe-audio tick.
 *
 * Flow per inbound audio attachment (mime audio/%, transcribed_at IS NULL,
 * created within the last 14 days — matches the partial index
 * `inbox_attachments_untranscribed_idx` from migration 0043):
 *   1. POST {CRM_TOOLS_API_URL}/skills/transcribe-audio (Whisper on the VPS),
 *      then poll /jobs/{id} + fetch /jobs/{id}/result — same job convention as
 *      run-task.ts. A synchronous `{ text }` start response is also accepted.
 *   2. On success: store transcript + transcribedAt on the attachment; if the
 *      parent message body is exactly "[Sprachnachricht]" (or empty), replace
 *      it with "[Sprachnachricht] <transcript>" so extraction reads it as text.
 *   3. On PERMANENT failure (HTTP 4xx except 401/403/408/429 — incl. 404 =
 *      skill not deployed yet — or a skill-reported job error / empty
 *      result): transcript = "" and
 *      transcribedAt = now. The empty string is the attempted-but-failed
 *      marker that keeps the row out of the pending query (no hot-looping).
 *   4. On TRANSIENT failure (network / 5xx / 401/403/408/429 / poll timeout):
 *      row untouched, the next tick retries.
 *
 * Every attempt is logged to ai_task_runs (provider "crm-tools", model
 * "whisper") like run-task.ts does. The top-level function NEVER throws —
 * it is a cron path and always returns counts.
 */

import { db } from "@/db";
import { aiTaskRuns, inboxMessageAttachments, inboxMessages } from "@/db/schema";
import { and, desc, eq, gte, isNull, like } from "drizzle-orm";
import { AI_TASK_SLUGS } from "./ai/task-registry";

// Same crm-tools env + polling conventions as run-task.ts.
const CRM_TOOLS_API_URL = process.env.CRM_TOOLS_API_URL;
const CRM_TOOLS_AUTH_TOKEN = process.env.CRM_TOOLS_AUTH_TOKEN;
const POLL_INTERVAL_MS = 3000;
// Per-job poll budget. Must exceed the VPS-side timeout_sec below so we never
// abandon a job the VPS will still finish (see run-task.ts rationale).
const JOB_POLL_MAX_MS = 90_000;
const VPS_TIMEOUT_SEC = 85;
// Overall budget: the route runs with maxDuration = 120, so stop starting
// new jobs early enough that the function always returns gracefully. The
// route passes ONE deadline for the whole invocation (all workspaces); the
// fallback below only applies when called without opts.deadline.
export const OVERALL_BUDGET_MS = 100_000;

const MODEL_TAG = "whisper";
const PLACEHOLDER_BODY = "[Sprachnachricht]";
const DEFAULT_LIMIT = 5;
const LOOKBACK_MS = 14 * 24 * 60 * 60 * 1000;

type TranscribeOutcome =
  | { kind: "success"; text: string }
  // permanent → mark the attachment attempted (transcript = "") so the 5-min
  // cron cannot hot-loop on a skill that 404s (not deployed) or rejects the file.
  | { kind: "permanent"; error: string }
  // transient → leave the row untouched; the next tick retries.
  | { kind: "transient"; error: string };

/**
 * Start a transcribe-audio job on crm-tools, poll it, and return the text.
 * Mirrors runViaCrmTools/humanizeViaCrmTools in run-task.ts (start → poll
 * /jobs/{id} → fetch /jobs/{id}/result), but classifies failures into
 * permanent vs transient for the marker logic above.
 */
async function callTranscribeSkill(params: {
  workspaceId: string;
  audioBase64: string;
  mimeType: string;
  overallDeadline: number;
}): Promise<TranscribeOutcome> {
  // 1) Start the job. Generous request timeout (base64 upload is large), but
  // never past the overall deadline; an abort lands in the catch → transient.
  let startResp: Response;
  try {
    startResp = await fetch(`${CRM_TOOLS_API_URL}/skills/transcribe-audio`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${CRM_TOOLS_AUTH_TOKEN}`,
      },
      body: JSON.stringify({
        params: {
          audio_base64: params.audioBase64,
          mime_type: params.mimeType,
          language: "de",
          _workspace_id: params.workspaceId,
          _task_slug: AI_TASK_SLUGS.INBOX_TRANSCRIBE_AUDIO,
        },
        timeout_sec: VPS_TIMEOUT_SEC,
      }),
      signal: AbortSignal.timeout(
        Math.max(1, Math.min(20_000, params.overallDeadline - Date.now()))
      ),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "fetch failed";
    return { kind: "transient", error: `start: ${msg}` };
  }
  if (!startResp.ok) {
    const msg = `start HTTP ${startResp.status}`;
    // Auth (401/403), request timeout (408) and rate limit (429) can heal
    // without a payload change → transient, row untouched.
    if ([401, 403, 408, 429].includes(startResp.status)) {
      if (startResp.status === 401 || startResp.status === 403) {
        console.warn(
          `[inbox-transcribe] ${msg} — check CRM_TOOLS_AUTH_TOKEN (wrong or rotated token?)`
        );
      }
      return { kind: "transient", error: msg };
    }
    // Other 4xx (esp. 404 = skill not deployed on the VPS yet) will not heal
    // by retrying the same payload every 5 minutes → permanent.
    if (startResp.status >= 400 && startResp.status < 500) {
      return { kind: "permanent", error: msg };
    }
    return { kind: "transient", error: msg };
  }

  let jobId = "";
  try {
    const startData = (await startResp.json()) as { job_id?: string; text?: string };
    // Tolerate a synchronous skill contract: a direct { text } means done.
    if (typeof startData.text === "string" && startData.text.trim()) {
      return { kind: "success", text: startData.text.trim() };
    }
    jobId = startData.job_id ?? "";
  } catch {
    return { kind: "transient", error: "start: invalid JSON response" };
  }
  if (!jobId) {
    return { kind: "transient", error: "start: no job_id in response" };
  }

  // 2) Poll until done/error/timeout (also bounded by the overall tick budget).
  const deadline = Math.min(Date.now() + JOB_POLL_MAX_MS, params.overallDeadline);
  let done = false;
  let lastErrorMsg: string | null = null;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    try {
      const pollResp = await fetch(`${CRM_TOOLS_API_URL}/jobs/${jobId}`, {
        headers: { Authorization: `Bearer ${CRM_TOOLS_AUTH_TOKEN}` },
        cache: "no-store",
        // Abort lands in the catch below → transient (deadline check re-runs).
        signal: AbortSignal.timeout(10_000),
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
        done = true;
        break;
      }
      if (pollData.status === "error") {
        // The skill ran and reported failure (bad/undecodable audio, VPS-side
        // timeout). Deterministic for the same payload → permanent.
        return { kind: "permanent", error: `job error: ${pollData.error ?? "unknown"}` };
      }
    } catch (err) {
      lastErrorMsg = err instanceof Error ? err.message : "poll exception";
    }
  }
  if (!done) {
    return {
      kind: "transient",
      error: `poll timeout${lastErrorMsg ? ` (last: ${lastErrorMsg})` : ""}`,
    };
  }

  // 3) Fetch the result.
  try {
    const resultResp = await fetch(`${CRM_TOOLS_API_URL}/jobs/${jobId}/result`, {
      headers: { Authorization: `Bearer ${CRM_TOOLS_AUTH_TOKEN}` },
      // Abort lands in the catch below → transient (row untouched).
      signal: AbortSignal.timeout(15_000),
    });
    if (!resultResp.ok) {
      return { kind: "transient", error: `result HTTP ${resultResp.status}` };
    }
    const resultPayload = (await resultResp.json()) as { text?: string };
    const text = (resultPayload.text ?? "").trim();
    if (!text) {
      // Job "done" but no text — silence or contract mismatch. Retrying the
      // same audio would return the same nothing → permanent.
      return { kind: "permanent", error: "empty result.text" };
    }
    return { kind: "success", text };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "result fetch failed";
    return { kind: "transient", error: `result: ${msg}` };
  }
}

/** One ai_task_runs row per attempt, mirroring logRun in run-task.ts. */
async function logRun(params: {
  workspaceId: string;
  latencyMs: number;
  success: boolean;
  errorMessage: string | null;
}): Promise<void> {
  await db.insert(aiTaskRuns).values({
    workspaceId: params.workspaceId,
    taskSlug: AI_TASK_SLUGS.INBOX_TRANSCRIBE_AUDIO,
    provider: "crm-tools",
    model: MODEL_TAG,
    inputTokens: null,
    outputTokens: null,
    costUsd: null,
    latencyMs: params.latencyMs,
    success: params.success,
    errorMessage: params.errorMessage,
  });
  console.log(
    `[ai] ${AI_TASK_SLUGS.INBOX_TRANSCRIBE_AUDIO} provider=crm-tools model=${MODEL_TAG} ` +
      `ok=${params.success} latency=${params.latencyMs}ms` +
      (params.errorMessage ? ` error=${params.errorMessage.slice(0, 160)}` : "")
  );
}

export interface TranscribeTickSummary {
  attempted: number;
  succeeded: number;
  failed: number;
}

/**
 * Transcribe pending inbound audio attachments for one workspace, newest
 * first. Never throws (cron path) — always returns counts.
 */
export async function transcribePendingAudio(
  workspaceId: string,
  opts?: { limit?: number; deadline?: number }
): Promise<TranscribeTickSummary> {
  const summary: TranscribeTickSummary = { attempted: 0, succeeded: 0, failed: 0 };

  try {
    const cutoff = new Date(Date.now() - LOOKBACK_MS);
    const pending = await db
      .select({
        attachmentId: inboxMessageAttachments.id,
        mimeType: inboxMessageAttachments.mimeType,
        fileContent: inboxMessageAttachments.fileContent,
        messageId: inboxMessages.id,
        messageBody: inboxMessages.body,
      })
      .from(inboxMessageAttachments)
      .innerJoin(inboxMessages, eq(inboxMessageAttachments.messageId, inboxMessages.id))
      .where(
        and(
          eq(inboxMessageAttachments.workspaceId, workspaceId),
          like(inboxMessageAttachments.mimeType, "audio/%"),
          isNull(inboxMessageAttachments.transcribedAt),
          gte(inboxMessageAttachments.createdAt, cutoff),
          eq(inboxMessages.direction, "inbound")
        )
      )
      .orderBy(desc(inboxMessageAttachments.createdAt))
      .limit(opts?.limit ?? DEFAULT_LIMIT);

    if (pending.length === 0) return summary;

    if (!CRM_TOOLS_API_URL || !CRM_TOOLS_AUTH_TOKEN) {
      // Not a permanent failure of the attachments — leave them pending until
      // the env is configured (same env names as run-task.ts).
      console.warn(
        "[inbox-transcribe] crm-tools env not configured (CRM_TOOLS_API_URL / CRM_TOOLS_AUTH_TOKEN); skipping tick"
      );
      return summary;
    }

    const overallDeadline = opts?.deadline ?? Date.now() + OVERALL_BUDGET_MS;

    for (const row of pending) {
      // Don't start a job we have no time left to poll.
      if (Date.now() >= overallDeadline - POLL_INTERVAL_MS * 2) break;

      summary.attempted += 1;
      const started = Date.now();
      try {
        const outcome = await callTranscribeSkill({
          workspaceId,
          audioBase64: row.fileContent,
          mimeType: row.mimeType,
          overallDeadline,
        });
        const latencyMs = Date.now() - started;

        if (outcome.kind === "success") {
          await db
            .update(inboxMessageAttachments)
            .set({ transcript: outcome.text, transcribedAt: new Date() })
            .where(eq(inboxMessageAttachments.id, row.attachmentId));
          // Re-read the current body: the batch snapshot is stale when one
          // message carries several audio attachments — a later transcript
          // must append to the first, not overwrite it.
          const [currentMsg] = await db
            .select({ body: inboxMessages.body })
            .from(inboxMessages)
            .where(eq(inboxMessages.id, row.messageId))
            .limit(1);
          const body = (currentMsg?.body ?? row.messageBody).trim();
          if (body === "" || body === PLACEHOLDER_BODY) {
            await db
              .update(inboxMessages)
              .set({ body: `${PLACEHOLDER_BODY} ${outcome.text}` })
              .where(eq(inboxMessages.id, row.messageId));
          } else if (body.startsWith(PLACEHOLDER_BODY)) {
            // Already holds an earlier transcript → append this one.
            await db
              .update(inboxMessages)
              .set({ body: `${body} ${outcome.text}` })
              .where(eq(inboxMessages.id, row.messageId));
          }
          // else: real text — never overwrite (transcript is still stored on
          // the attachment row above).
          await logRun({ workspaceId, latencyMs, success: true, errorMessage: null });
          summary.succeeded += 1;
        } else if (outcome.kind === "permanent") {
          // Attempted-but-failed marker: keeps the row out of the pending
          // query so a missing/broken skill can't cause a retry storm.
          await db
            .update(inboxMessageAttachments)
            .set({ transcript: "", transcribedAt: new Date() })
            .where(eq(inboxMessageAttachments.id, row.attachmentId));
          console.warn(
            `[inbox-transcribe] permanent failure for attachment ${row.attachmentId}: ${outcome.error}`
          );
          await logRun({
            workspaceId,
            latencyMs,
            success: false,
            errorMessage: `permanent: ${outcome.error}`,
          });
          summary.failed += 1;
        } else {
          // Transient: leave the attachment untouched for the next tick.
          console.warn(
            `[inbox-transcribe] transient failure for attachment ${row.attachmentId}: ${outcome.error}`
          );
          await logRun({
            workspaceId,
            latencyMs,
            success: false,
            errorMessage: `transient: ${outcome.error}`,
          });
          summary.failed += 1;
        }
      } catch (err) {
        // Unexpected (e.g. DB) error for this attachment — count it, move on.
        console.error(`[inbox-transcribe] attachment ${row.attachmentId} failed:`, err);
        summary.failed += 1;
      }
    }
  } catch (err) {
    // Cron path: never throw.
    console.error("[inbox-transcribe] tick failed:", err);
  }

  return summary;
}
