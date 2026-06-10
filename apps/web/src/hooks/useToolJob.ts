// apps/web/src/hooks/useToolJob.ts
//
// React hook: starts a crm-tools job and polls until it's done or errors.
//
//   const { start, status, jobId, error, result, reset } = useToolJob();
//   await start("order-confirmation", { deal_id: "..." });
//   // status transitions: idle → starting → running → done/error
//
// Poll resilience: a single failed poll (network blip, laptop sleep, Vercel
// hiccup) does NOT flip the UI to error while the VPS job keeps running.
// Transient failures retry with backoff; polling also resumes when the tab
// regains focus. Only MAX_CONSECUTIVE_POLL_FAILURES in a row is terminal.
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

const POLL_INTERVAL_MS = 2000;
const MAX_CONSECUTIVE_POLL_FAILURES = 5;

export function useToolJob() {
  const [status, setStatus] = useState<ToolJobStatus>("idle");
  const [jobId, setJobId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<JobStatePayload | null>(null);
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const failStreak = useRef(0);
  const activeJobId = useRef<string | null>(null);

  const clearTimer = () => {
    if (pollTimer.current) {
      clearTimeout(pollTimer.current);
      pollTimer.current = null;
    }
  };

  const reset = useCallback(() => {
    clearTimer();
    activeJobId.current = null;
    failStreak.current = 0;
    setStatus("idle");
    setJobId(null);
    setError(null);
    setResult(null);
  }, []);

  const poll = useCallback(async (id: string) => {
    if (activeJobId.current !== id) return; // stale poll after reset/restart
    try {
      const resp = await fetch(`/api/tools/jobs/${id}`, { cache: "no-store" });
      if (!resp.ok) throw new Error(`poll ${resp.status}`);
      const data = (await resp.json()) as JobStatePayload;
      failStreak.current = 0;
      setResult(data);
      if (data.status === "done") {
        activeJobId.current = null;
        setStatus("done");
        return;
      }
      if (data.status === "error") {
        activeJobId.current = null;
        setStatus("error");
        setError(data.error || "skill error");
        return;
      }
      setStatus(data.status);
      pollTimer.current = setTimeout(() => poll(id), POLL_INTERVAL_MS);
    } catch (e) {
      failStreak.current += 1;
      if (failStreak.current >= MAX_CONSECUTIVE_POLL_FAILURES) {
        activeJobId.current = null;
        setStatus("error");
        setError(
          `Verbindung zum Job verloren (${(e as Error).message}). ` +
            "Der Job läuft auf dem Server vermutlich weiter; das PDF wird " +
            "trotzdem am Lead gespeichert, sobald es fertig ist."
        );
        return;
      }
      // Backoff: 2s, 4s, 6s, 8s before the next attempt.
      pollTimer.current = setTimeout(
        () => poll(id),
        POLL_INTERVAL_MS * (failStreak.current + 1)
      );
    }
  }, []);

  // When the tab regains focus or connectivity, poll immediately instead of
  // waiting out a backoff timer (laptop wake is the common real-world case).
  useEffect(() => {
    const kick = () => {
      const id = activeJobId.current;
      if (!id) return;
      clearTimer();
      failStreak.current = 0;
      void poll(id);
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") kick();
    };
    window.addEventListener("focus", kick);
    window.addEventListener("online", kick);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("focus", kick);
      window.removeEventListener("online", kick);
      document.removeEventListener("visibilitychange", onVisible);
      clearTimer();
    };
  }, [poll]);

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
        activeJobId.current = data.job_id;
        failStreak.current = 0;
        setJobId(data.job_id);
        setStatus("queued");
        void poll(data.job_id);
      } catch (e) {
        setStatus("error");
        setError((e as Error).message);
      }
    },
    [poll, reset]
  );

  return { start, reset, status, jobId, error, result };
}
