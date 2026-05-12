// apps/web/src/hooks/useToolJob.ts
//
// React hook: starts a crm-tools job and polls until it's done or errors.
//
//   const { start, status, jobId, error, result, reset } = useToolJob();
//   await start("order-confirmation", { deal_id: "..." });
//   // status transitions: idle → starting → running → done/error
"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type ToolJobStatus =
  | "idle"
  | "starting"
  | "queued"
  | "running"
  | "done"
  | "error";

interface JobStatePayload {
  id: string;
  skill: string;
  status: "queued" | "running" | "done" | "error";
  started_at: string;
  finished_at: string | null;
  error: string | null;
  has_result: boolean;
  result_content_type: string | null;
  result_filename: string | null;
}

export function useToolJob() {
  const [status, setStatus] = useState<ToolJobStatus>("idle");
  const [jobId, setJobId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<JobStatePayload | null>(null);
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = () => {
    if (pollTimer.current) {
      clearTimeout(pollTimer.current);
      pollTimer.current = null;
    }
  };

  useEffect(() => clearTimer, []);

  const reset = useCallback(() => {
    clearTimer();
    setStatus("idle");
    setJobId(null);
    setError(null);
    setResult(null);
  }, []);

  const poll = useCallback(async (id: string) => {
    try {
      const resp = await fetch(`/api/tools/jobs/${id}`, { cache: "no-store" });
      if (!resp.ok) throw new Error(`poll ${resp.status}`);
      const data = (await resp.json()) as JobStatePayload;
      setResult(data);
      if (data.status === "done") {
        setStatus("done");
        return;
      }
      if (data.status === "error") {
        setStatus("error");
        setError(data.error || "skill error");
        return;
      }
      setStatus(data.status);
      pollTimer.current = setTimeout(() => poll(id), 2000);
    } catch (e) {
      setStatus("error");
      setError((e as Error).message);
    }
  }, []);

  const start = useCallback(
    async (skill: string, params: Record<string, unknown> = {}) => {
      reset();
      setStatus("starting");
      try {
        const resp = await fetch("/api/tools/run", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ skill, params }),
        });
        if (!resp.ok) {
          const text = await resp.text();
          throw new Error(`run ${resp.status}: ${text}`);
        }
        const data = (await resp.json()) as { job_id: string };
        setJobId(data.job_id);
        setStatus("queued");
        poll(data.job_id);
      } catch (e) {
        setStatus("error");
        setError((e as Error).message);
      }
    },
    [poll, reset]
  );

  return { start, reset, status, jobId, error, result };
}
