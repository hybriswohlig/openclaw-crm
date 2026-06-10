// apps/web/src/components/background-jobs.tsx
//
// Global background-job center: document generation (AB/RE/AW) and
// KI-Analyse runs are tracked HERE instead of inside a blocking modal, so
// the user can keep working anywhere in the app. While a job runs, a small
// pill shows in the bottom-right corner; when it finishes, the pill becomes
// a popup with the result actions (PDF öffnen / Vorschläge ansehen).
//
// Document jobs also perform the store-as-document step server-call from
// here, so the PDF lands on the deal's Finanzen tab even when the dialog
// that started the job is long closed.
//
// Note: state lives in memory for the SPA session. A full browser reload
// drops the client-side tracking (the VPS job itself keeps running and the
// PDF can be re-fetched for 24h); the durable Postgres job table is a
// planned follow-up.
"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, Sparkles, X } from "lucide-react";

export type BackgroundDocType = "AB" | "RE" | "AW";

export interface DocumentJobState {
  kind: "document";
  id: string;
  vpsJobId: string;
  dealRecordId: string;
  label: string;
  docType: BackgroundDocType;
  status: "running" | "done" | "error";
  filename: string | null;
  stored: boolean;
  storing: boolean;
  storeError: string | null;
  rechnungFaelligAm: string | null;
  error: string | null;
  startedAt: number;
}

export interface InsightsResultPayload {
  insights: unknown;
  transcript: unknown;
  fingerprint?: string;
}

export interface InsightsJobState {
  kind: "insights";
  id: string;
  dealRecordId: string;
  label: string;
  source: "deal-page" | "context-panel";
  docType?: "AB" | "RE";
  status: "running" | "done" | "error";
  result: InsightsResultPayload | null;
  error: string | null;
  startedAt: number;
}

export type BackgroundJobState = DocumentJobState | InsightsJobState;

interface StartDocumentArgs {
  skill: string;
  params: Record<string, unknown>;
  dealRecordId: string;
  label: string;
  docType: BackgroundDocType;
}

interface StartInsightsArgs {
  dealRecordId: string;
  label: string;
  source: "deal-page" | "context-panel";
  docType?: "AB" | "RE";
}

interface BackgroundJobsApi {
  jobs: BackgroundJobState[];
  /** Starts a crm-tools document job. Throws if the job cannot be STARTED
   * (so the dialog can show the validation error inline); once started,
   * progress and completion are handled by the global tray. */
  startDocumentJob(args: StartDocumentArgs): Promise<void>;
  /** Fire-and-forget KI-Analyse (preview extraction). Completion surfaces
   * as a popup; pages consume the result via takeInsightsResult. */
  startInsightsJob(args: StartInsightsArgs): void;
  /** Consume (remove and return) a finished KI-Analyse for a deal. Pages
   * call this from an effect so the review UI opens wherever the user is. */
  takeInsightsResult(
    dealRecordId: string,
    source?: "deal-page" | "context-panel"
  ): InsightsJobState | null;
  dismissJob(id: string): void;
}

const BackgroundJobsContext = createContext<BackgroundJobsApi | null>(null);

export function useBackgroundJobs(): BackgroundJobsApi {
  const ctx = useContext(BackgroundJobsContext);
  if (!ctx) {
    throw new Error("useBackgroundJobs must be used inside BackgroundJobsProvider");
  }
  return ctx;
}

const POLL_INTERVAL_MS = 2000;
const MAX_CONSECUTIVE_POLL_FAILURES = 8;

interface JobPollPayload {
  status: "queued" | "running" | "done" | "error";
  error: string | null;
  result_filename: string | null;
}

let jobCounter = 0;
function nextLocalId(): string {
  jobCounter += 1;
  return `bgjob-${jobCounter}-${Math.random().toString(36).slice(2, 8)}`;
}

export function BackgroundJobsProvider({ children }: { children: React.ReactNode }) {
  const [jobs, setJobs] = useState<BackgroundJobState[]>([]);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const failStreaks = useRef(new Map<string, number>());

  const patchJob = useCallback((id: string, patch: Partial<BackgroundJobState>) => {
    setJobs((prev) =>
      prev.map((j) => (j.id === id ? ({ ...j, ...patch } as BackgroundJobState) : j))
    );
  }, []);

  const dismissJob = useCallback((id: string) => {
    const t = timers.current.get(id);
    if (t) clearTimeout(t);
    timers.current.delete(id);
    failStreaks.current.delete(id);
    setJobs((prev) => prev.filter((j) => j.id !== id));
  }, []);

  /** Attach the finished PDF to the deal (Finanzen tab). */
  const storeDocument = useCallback(
    async (job: Pick<DocumentJobState, "id" | "vpsJobId" | "dealRecordId" | "docType">) => {
      patchJob(job.id, { storing: true, storeError: null });
      try {
        const resp = await fetch(`/api/tools/jobs/${job.vpsJobId}/store-as-document`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            dealRecordId: job.dealRecordId,
            ...(job.docType === "AW" ? { documentType: "worker_instructions" } : {}),
          }),
        });
        const data = await resp.json().catch(() => null);
        if (!resp.ok) throw new Error(data?.error || `upload ${resp.status}`);
        patchJob(job.id, {
          storing: false,
          stored: true,
          rechnungFaelligAm:
            typeof data?.rechnungFaelligAm === "string" ? data.rechnungFaelligAm : null,
        });
      } catch (e) {
        patchJob(job.id, { storing: false, storeError: (e as Error).message });
      }
    },
    [patchJob]
  );

  const pollDocumentJob = useCallback(
    async (localId: string, vpsJobId: string, meta: Omit<StartDocumentArgs, "skill" | "params">) => {
      try {
        const resp = await fetch(`/api/tools/jobs/${vpsJobId}`, { cache: "no-store" });
        if (!resp.ok) throw new Error(`poll ${resp.status}`);
        const data = (await resp.json()) as JobPollPayload;
        failStreaks.current.set(localId, 0);
        if (data.status === "done") {
          patchJob(localId, { status: "done", filename: data.result_filename ?? null });
          void storeDocument({
            id: localId,
            vpsJobId,
            dealRecordId: meta.dealRecordId,
            docType: meta.docType,
          });
          return;
        }
        if (data.status === "error") {
          patchJob(localId, { status: "error", error: data.error || "Skill-Fehler" });
          return;
        }
        timers.current.set(
          localId,
          setTimeout(() => void pollDocumentJob(localId, vpsJobId, meta), POLL_INTERVAL_MS)
        );
      } catch (e) {
        const streak = (failStreaks.current.get(localId) ?? 0) + 1;
        failStreaks.current.set(localId, streak);
        if (streak >= MAX_CONSECUTIVE_POLL_FAILURES) {
          patchJob(localId, {
            status: "error",
            error:
              `Verbindung zum Job verloren (${(e as Error).message}). ` +
              "Der Job läuft auf dem Server vermutlich weiter; das PDF bleibt " +
              "dort 24h abrufbar.",
          });
          return;
        }
        timers.current.set(
          localId,
          setTimeout(
            () => void pollDocumentJob(localId, vpsJobId, meta),
            POLL_INTERVAL_MS * Math.min(streak + 1, 5)
          )
        );
      }
    },
    [patchJob, storeDocument]
  );

  const startDocumentJob = useCallback(
    async ({ skill, params, dealRecordId, label, docType }: StartDocumentArgs) => {
      const resp = await fetch("/api/tools/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ skill, params }),
      });
      if (!resp.ok) {
        const text = await resp.text();
        throw new Error(`Start fehlgeschlagen (${resp.status}): ${text.slice(0, 300)}`);
      }
      const data = (await resp.json()) as { job_id: string };
      const localId = nextLocalId();
      setJobs((prev) => [
        ...prev,
        {
          kind: "document",
          id: localId,
          vpsJobId: data.job_id,
          dealRecordId,
          label,
          docType,
          status: "running",
          filename: null,
          stored: false,
          storing: false,
          storeError: null,
          rechnungFaelligAm: null,
          error: null,
          startedAt: Date.now(),
        },
      ]);
      timers.current.set(
        localId,
        setTimeout(
          () => void pollDocumentJob(localId, data.job_id, { dealRecordId, label, docType }),
          POLL_INTERVAL_MS
        )
      );
    },
    [pollDocumentJob]
  );

  const startInsightsJob = useCallback(
    ({ dealRecordId, label, source, docType }: StartInsightsArgs) => {
      const localId = nextLocalId();
      setJobs((prev) => [
        ...prev,
        {
          kind: "insights",
          id: localId,
          dealRecordId,
          label,
          source,
          docType,
          status: "running",
          result: null,
          error: null,
          startedAt: Date.now(),
        },
      ]);
      void (async () => {
        try {
          const res = await fetch(`/api/v1/deals/${dealRecordId}/insights`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ apply: false }),
          });
          if (!res.ok) {
            patchJob(localId, { status: "error", error: "Analyse fehlgeschlagen." });
            return;
          }
          const data = (await res.json()) as {
            data?: {
              insights?: unknown;
              transcript?: unknown;
              fingerprint?: string;
              error?: string;
            };
          };
          const d = data.data;
          if (!d?.insights) {
            patchJob(localId, {
              status: "error",
              error: d?.error ?? "Keine Nachrichten mit diesem Lead verknüpft.",
            });
            return;
          }
          patchJob(localId, {
            status: "done",
            result: {
              insights: d.insights,
              transcript: d.transcript,
              fingerprint: typeof d.fingerprint === "string" ? d.fingerprint : undefined,
            },
          });
        } catch {
          patchJob(localId, { status: "error", error: "Netzwerkfehler bei der Analyse." });
        }
      })();
    },
    [patchJob]
  );

  const takeInsightsResult = useCallback(
    (dealRecordId: string, source?: "deal-page" | "context-panel") => {
      let taken: InsightsJobState | null = null;
      setJobs((prev) => {
        const candidate = prev.find(
          (j): j is InsightsJobState =>
            j.kind === "insights" &&
            j.dealRecordId === dealRecordId &&
            j.status !== "running" &&
            (source === undefined || j.source === source)
        );
        if (!candidate) return prev;
        taken = candidate;
        return prev.filter((j) => j.id !== candidate.id);
      });
      return taken;
    },
    []
  );

  // Resume polling promptly when the tab regains focus or connectivity
  // (laptop wake is the common case for poll-failure streaks).
  useEffect(() => {
    const kick = () => {
      failStreaks.current.forEach((_v, k) => failStreaks.current.set(k, 0));
    };
    window.addEventListener("focus", kick);
    window.addEventListener("online", kick);
    return () => {
      window.removeEventListener("focus", kick);
      window.removeEventListener("online", kick);
    };
  }, []);

  // Cleanup all timers on unmount.
  useEffect(() => {
    const t = timers.current;
    return () => {
      t.forEach((timer) => clearTimeout(timer));
      t.clear();
    };
  }, []);

  const api: BackgroundJobsApi = {
    jobs,
    startDocumentJob,
    startInsightsJob,
    takeInsightsResult,
    dismissJob,
  };

  return (
    <BackgroundJobsContext.Provider value={api}>
      {children}
      <BackgroundJobsTray
        jobs={jobs}
        dismissJob={dismissJob}
        retryStore={(job) =>
          void storeDocument({
            id: job.id,
            vpsJobId: job.vpsJobId,
            dealRecordId: job.dealRecordId,
            docType: job.docType,
          })
        }
      />
    </BackgroundJobsContext.Provider>
  );
}

// ─── Tray UI ─────────────────────────────────────────────────────────────────

const DOC_TYPE_TITLES: Record<BackgroundDocType, string> = {
  AB: "Auftragsbestätigung",
  RE: "Rechnung",
  AW: "Auftragsanweisung",
};

function elapsedLabel(startedAt: number, now: number): string {
  const s = Math.max(0, Math.floor((now - startedAt) / 1000));
  const mm = Math.floor(s / 60);
  const ss = String(s % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

function BackgroundJobsTray({
  jobs,
  dismissJob,
  retryStore,
}: {
  jobs: BackgroundJobState[];
  dismissJob: (id: string) => void;
  retryStore: (job: DocumentJobState) => void;
}) {
  const router = useRouter();
  const [now, setNow] = useState(() => Date.now());
  const anyRunning = jobs.some((j) => j.status === "running");

  useEffect(() => {
    if (!anyRunning) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [anyRunning]);

  if (jobs.length === 0) return null;

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[70] flex w-[min(100vw-2rem,360px)] flex-col gap-2">
      {jobs.map((job) => (
        <div
          key={job.id}
          className={
            "pointer-events-auto rounded-lg border shadow-lg backdrop-blur " +
            (job.status === "error"
              ? "border-red-300 bg-red-50/95 dark:border-red-900 dark:bg-red-950/90"
              : job.status === "done"
                ? "border-emerald-300 bg-white/95 dark:border-emerald-800 dark:bg-gray-900/95"
                : "border-border bg-white/90 dark:bg-gray-900/90")
          }
        >
          {/* Running pill */}
          {job.status === "running" && (
            <div className="flex items-center gap-2 px-3 py-2">
              <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-xs font-medium">
                  {job.kind === "document"
                    ? `${DOC_TYPE_TITLES[job.docType]} wird erstellt…`
                    : "KI-Analyse läuft…"}
                </div>
                <div className="truncate text-[10px] text-muted-foreground">
                  {job.label} · {elapsedLabel(job.startedAt, now)} min
                </div>
              </div>
            </div>
          )}

          {/* Finished document popup */}
          {job.kind === "document" && job.status === "done" && (
            <div className="space-y-2 px-3 py-2.5">
              <div className="flex items-start gap-2">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-semibold">
                    {job.filename ?? `${DOC_TYPE_TITLES[job.docType]} fertig`}
                  </div>
                  <div className="truncate text-[10px] text-muted-foreground">{job.label}</div>
                </div>
                <button
                  onClick={() => dismissJob(job.id)}
                  className="rounded p-0.5 text-muted-foreground hover:bg-muted"
                  aria-label="Schließen"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <a
                  href={`/api/tools/jobs/${job.vpsJobId}/result`}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded border border-border bg-card px-2.5 py-1 text-[11px] font-medium hover:bg-accent"
                >
                  PDF öffnen
                </a>
                {job.storing && (
                  <span className="text-[10px] text-muted-foreground">Wird angehängt…</span>
                )}
                {job.stored && (
                  <span className="rounded bg-emerald-100 px-2 py-1 text-[10px] text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-200">
                    ✓ Im Finanzen-Tab angehängt
                  </span>
                )}
                {!job.storing && !job.stored && job.storeError && (
                  <button
                    onClick={() => retryStore(job)}
                    className="rounded bg-blue-600 px-2.5 py-1 text-[11px] text-white hover:bg-blue-700"
                  >
                    Erneut anhängen
                  </button>
                )}
              </div>
              {job.rechnungFaelligAm && (
                <p className="text-[10px] text-muted-foreground">
                  Fälligkeitsdatum gesetzt: {job.rechnungFaelligAm}
                </p>
              )}
              {job.storeError && (
                <p className="text-[10px] text-red-600">{job.storeError}</p>
              )}
            </div>
          )}

          {/* Finished insights popup (only visible while no page consumed it) */}
          {job.kind === "insights" && job.status === "done" && (
            <div className="space-y-2 px-3 py-2.5">
              <div className="flex items-start gap-2">
                <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-violet-500" />
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-semibold">KI-Analyse fertig</div>
                  <div className="truncate text-[10px] text-muted-foreground">{job.label}</div>
                </div>
                <button
                  onClick={() => dismissJob(job.id)}
                  className="rounded p-0.5 text-muted-foreground hover:bg-muted"
                  aria-label="Schließen"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
              <button
                onClick={() => router.push(`/objects/deals/${job.dealRecordId}`)}
                className="rounded bg-blue-600 px-2.5 py-1 text-[11px] text-white hover:bg-blue-700"
              >
                Vorschläge ansehen
              </button>
            </div>
          )}

          {/* Error popup */}
          {job.status === "error" && (
            <div className="space-y-1.5 px-3 py-2.5">
              <div className="flex items-start gap-2">
                <X className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-semibold text-red-800 dark:text-red-200">
                    {job.kind === "document"
                      ? `${DOC_TYPE_TITLES[job.docType]} fehlgeschlagen`
                      : "KI-Analyse fehlgeschlagen"}
                  </div>
                  <div className="truncate text-[10px] text-muted-foreground">{job.label}</div>
                </div>
                <button
                  onClick={() => dismissJob(job.id)}
                  className="rounded p-0.5 text-muted-foreground hover:bg-muted"
                  aria-label="Schließen"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
              <p className="break-words text-[10px] leading-snug text-red-700 dark:text-red-300">
                {job.error}
              </p>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
