"use client";

// Timeline tab: the same SprintTimeline component as the dashboard, but the
// window comes from the PROJECT, not from a sprint. A project task without a
// sprint_id — the normal state straight out of the wizard — must still show
// up here, so the fetch passes projectId and never filters client-side.
import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { useSession } from "@/lib/auth-client";
import type { ProjectJSON, TaskJSON, TaskListJSON, TimelineJSON } from "@/lib/work-types";
import { SprintTimeline } from "@/components/work/sprint-timeline";
import { WorkTaskDialog, type WorkTaskSavePayload } from "@/components/work/task-dialog";
import { EmptyState } from "@/components/work/empty-state";
import { hasTimelineDate, readApiError } from "@/lib/work-ui";

/** The project tab wants completeness, so it asks for a generous row cap. */
const PROJECT_MAX_BARS = 40;

export function TimelineTab({ project, reload }: { project: ProjectJSON; reload: () => Promise<void> }) {
  const { data: session } = useSession();
  // Safe without its own boundary: page.tsx already wraps the whole detail
  // page in <Suspense> (Task 33).
  const searchParams = useSearchParams();
  const [payload, setPayload] = useState<TimelineJSON | null>(null);
  const [tasks, setTasks] = useState<TaskJSON[]>([]);
  const [taskTotal, setTaskTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [editing, setEditing] = useState<TaskJSON | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [tl, tk] = await Promise.allSettled([
      // ?projectId=, never ?sprintId=: getSprintTimeline windows on the
      // PROJECT's own dates when given projectId, so a task with no
      // sprint_id — the normal case straight out of the wizard — still gets
      // a bar. Filtering a sprint-scoped fetch client-side would leave every
      // project without an active sprint empty (defect F5).
      fetch(
        `/api/v1/work/timeline?projectId=${encodeURIComponent(project.id)}&maxBarsPerRow=${PROJECT_MAX_BARS}`,
        { cache: "no-store" }
      ),
      // showCompleted=true: the timeline DRAWS completed bars, so the lookup
      // behind a bar click must be able to find them — otherwise clicking a
      // green bar does nothing (defects W3 + W8). limit is the route's cap.
      fetch(
        `/api/v1/tasks?projectId=${project.id}&includeSubtasks=true&showCompleted=true&limit=200`,
        { cache: "no-store" }
      ),
    ]);
    if (tl.status === "fulfilled" && tl.value.ok) {
      setPayload((((await tl.value.json())?.data ?? null) as TimelineJSON | null));
      setFailed(false);
    } else {
      setFailed(true);
    }
    if (tk.status === "fulfilled" && tk.value.ok) {
      const payloadTasks = ((await tk.value.json())?.data ?? null) as TaskListJSON | null;
      setTasks(payloadTasks?.tasks ?? []);
      setTaskTotal(payloadTasks?.pagination?.total ?? payloadTasks?.tasks?.length ?? 0);
    }
    setLoading(false);
  }, [project.id]);

  useEffect(() => {
    load();
  }, [load]);

  // The dashboard timeline deep-links here as
  // ?tab=zeitleiste&task=<taskId> (defect W8), so that bar must be selected
  // and scrolled to once the data is in. Runs once per id.
  const deepLinkTaskId = searchParams.get("task");
  const deepLinkDone = useRef<string | null>(null);
  useEffect(() => {
    if (!deepLinkTaskId || loading) return;
    if (deepLinkDone.current === deepLinkTaskId) return;
    deepLinkDone.current = deepLinkTaskId;
    setSelectedTaskId(deepLinkTaskId);
  }, [deepLinkTaskId, loading]);

  // No client-side filtering: the server already scoped the payload to this
  // project (F5). Filtering here would silently drop sprint-less tasks.
  const hasRow = (payload?.rows.length ?? 0) > 0;
  // hasTimelineDate mirrors computeTimelineBar's bar-eligibility check
  // exactly (lib/work-metrics.ts never falls back to createdAt), so this
  // stays a call to the shared helper instead of re-deriving the condition
  // inline (defect R17).
  const undated = tasks.filter((t) => !hasTimelineDate(t)).length;
  const outOfWindow = (payload?.rows ?? []).reduce((n, r) => n + (r.outOfWindowBars ?? 0), 0);
  const truncated = (payload?.rows ?? []).reduce((n, r) => n + (r.truncatedBars ?? 0), 0);

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[13px]" style={{ color: "var(--muted-foreground)" }}>
          Alle Aufgaben dieses Projekts mit Datum — unabhängig davon, ob sie einem Sprint zugeordnet sind.
        </p>
        <span className="k-mono text-[11.5px]" style={{ color: "var(--muted-foreground)" }}>
          {undated > 0 && <>{undated} ohne Datum · </>}
          {outOfWindow > 0 && (
            <span style={{ color: "var(--warn)" }}>{outOfWindow} ausserhalb des Zeitraums · </span>
          )}
          {truncated > 0 && <span style={{ color: "var(--warn)" }}>{truncated} nicht gezeichnet · </span>}
          {taskTotal > tasks.length ? `${tasks.length} von ${taskTotal} geladen` : `${taskTotal} Aufgaben`}
        </span>
      </div>

      {!loading && !hasRow && !failed ? (
        <div className="k-card">
          <EmptyState
            title="Keine Aufgabe mit Datum"
            hint="Balken entstehen aus Startdatum oder Fälligkeit. Trag bei mindestens einer Aufgabe ein Datum ein, dann erscheint sie hier."
          />
        </div>
      ) : (
        <SprintTimeline
          data={payload}
          loading={loading && !payload}
          error={failed}
          selectedTaskId={selectedTaskId}
          onSelectTask={setSelectedTaskId}
          onTaskClick={(taskId) => {
            const t = tasks.find((x) => x.id === taskId);
            if (t) {
              setEditing(t);
              setDialogOpen(true);
              return;
            }
            // Should not happen now that showCompleted=true, but a click must
            // never be a silent no-op (defect W8): say so out loud.
            toast.error("Aufgabe nicht in der geladenen Liste — bitte im Tab „Aufgaben“ öffnen");
          }}
        />
      )}

      {/* Task 44 hängt hier das Abhängigkeiten-Panel ein. */}

      <WorkTaskDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        mode="edit"
        task={editing}
        currentUserId={session?.user?.id}
        defaultKind="projekt"
        defaultProjectId={project.id}
        onSave={async (payloadBody: WorkTaskSavePayload) => {
          if (!editing) return;
          const res = await fetch(`/api/v1/tasks/${editing.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payloadBody),
          });
          if (!res.ok) throw new Error(await readApiError(res, "Speichern fehlgeschlagen"));
          toast.success("Aufgabe aktualisiert");
          await load();
          await reload();
        }}
      />
    </div>
  );
}
