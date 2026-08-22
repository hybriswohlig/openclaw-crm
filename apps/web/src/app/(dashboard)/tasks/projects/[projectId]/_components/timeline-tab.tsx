"use client";

// Timeline tab: the same SprintTimeline component as the dashboard, but the
// window comes from the PROJECT, not from a sprint. A project task without a
// sprint_id — the normal state straight out of the wizard — must still show
// up here, so the fetch passes projectId and never filters client-side.
import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { useSession } from "@/lib/auth-client";
import type { DependencyJSON, ProjectJSON, TaskJSON, TaskListJSON, TimelineJSON } from "@/lib/work-types";
import { SprintTimeline } from "@/components/work/sprint-timeline";
import { WorkTaskDialog, type WorkTaskSavePayload } from "@/components/work/task-dialog";
import { EmptyState } from "@/components/work/empty-state";
import { StatusChip } from "@/components/work/status-chip";
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
          // A single click only selects (anchors the dependency panel
          // below); the dialog would otherwise cover that panel. Editing
          // stays reachable via double-click or the Aufgaben tab.
          onTaskClick={undefined}
          onBarDoubleClick={(taskId) => {
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

      {selectedTaskId ? (
        <DependencyPanel
          taskId={selectedTaskId}
          tasks={tasks}
          onChanged={load}
          onClose={() => setSelectedTaskId(null)}
        />
      ) : (
        hasRow && (
          <p className="text-[12.5px]" style={{ color: "var(--muted-foreground)" }}>
            Klick auf einen Balken, um Abhängigkeiten zu bearbeiten.
          </p>
        )
      )}

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

// ── Dependency editing ────────────────────────────────────────────────
// Anchored on the bar the user selected in the timeline. That selected task is
// the one that WAITS: the route contract is
//   POST /api/v1/tasks/<successorId>/dependencies  { predecessorTaskId }
// i.e. the URL names the task that waits, the body names the task it waits for.
// Cycles are rejected server-side with a German message
// (services/task-dependencies.ts), which we surface verbatim instead of
// inventing our own wording.
function DependencyPanel({
  taskId,
  tasks,
  onChanged,
  onClose,
}: {
  taskId: string;
  tasks: TaskJSON[];
  onChanged: () => Promise<void>;
  onClose: () => void;
}) {
  const [deps, setDeps] = useState<DependencyJSON[]>([]);
  // The picked task is the PREDECESSOR — the one the selected task waits for.
  const [predecessorId, setPredecessorId] = useState("");
  const [busy, setBusy] = useState(false);

  const current = tasks.find((t) => t.id === taskId) ?? null;

  const loadDeps = useCallback(async () => {
    const res = await fetch(`/api/v1/tasks/${taskId}/dependencies`, { cache: "no-store" });
    if (res.ok) setDeps((((await res.json())?.data ?? []) as DependencyJSON[]));
  }, [taskId]);

  useEffect(() => {
    setPredecessorId("");
    loadDeps();
  }, [loadDeps]);

  const titleOf = (id: string) => tasks.find((t) => t.id === id)?.content ?? "(andere Aufgabe)";

  // Only exclude tasks that are ALREADY a predecessor of this one — excluding
  // everything linked in either direction would mean a task can never be given
  // a second predecessor once it has any edge at all (defect R17). Cycles are
  // the server's job and it reports them with a German message.
  const existingPredecessors = new Set(
    deps.filter((d) => d.successorTaskId === taskId).map((d) => d.predecessorTaskId)
  );
  const candidates = tasks.filter((t) => t.id !== taskId && !existingPredecessors.has(t.id));

  async function addDependency() {
    if (!predecessorId) return;
    setBusy(true);
    try {
      // The selected task is the successor and owns the edge, so it is the one
      // in the URL; the body names the predecessor it waits for.
      const res = await fetch(`/api/v1/tasks/${taskId}/dependencies`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ predecessorTaskId: predecessorId }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        // The service returns a German message on a cycle or a self-link.
        throw new Error(err?.error?.message ?? "Abhängigkeit konnte nicht angelegt werden");
      }
      toast.success("Abhängigkeit angelegt");
      setPredecessorId("");
      await loadDeps();
      await onChanged();
    } catch (e) {
      toast.error("Abhängigkeit nicht möglich", {
        description: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setBusy(false);
    }
  }

  // DELETE addresses the edge OWNER, i.e. the successor — the same rule as
  // POST. For a "wartet auf" row that is the selected task itself; for a
  // "blockiert" row it is the other task. Deriving it from the dependency
  // means a "blockiert" row can be removed without changing the selection.
  async function removeDependency(dep: DependencyJSON) {
    setBusy(true);
    try {
      const res = await fetch(
        `/api/v1/tasks/${dep.successorTaskId}/dependencies/${dep.id}`,
        { method: "DELETE" }
      );
      if (!res.ok) throw new Error("delete failed");
      toast.success("Abhängigkeit entfernt");
      await loadDeps();
      await onChanged();
    } catch {
      toast.error("Abhängigkeit konnte nicht entfernt werden");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="k-card p-4">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="k-label" style={{ fontSize: 10, color: "var(--muted-foreground)" }}>
            Abhängigkeiten
          </div>
          <div className="mt-0.5 truncate text-[13.5px] font-medium" style={{ color: "var(--foreground)" }}>
            {current?.content ?? "Aufgabe"}
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Panel schliessen"
          className="shrink-0 rounded-lg border border-border p-1.5 text-muted-foreground hover:bg-muted"
        >
          <X className="h-[13px] w-[13px]" />
        </button>
      </div>

      {deps.length === 0 ? (
        <p className="text-[12.5px]" style={{ color: "var(--muted-foreground)" }}>
          Noch keine Abhängigkeit. Lege unten fest, worauf diese Aufgabe wartet.
        </p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {deps.map((d) => {
            // The selected task is the successor → it waits for the other one.
            // It is the predecessor → it blocks the other one.
            const waits = d.successorTaskId === taskId;
            return (
              <li key={d.id} className="flex items-center gap-2">
                <StatusChip tone={waits ? "info" : "accent"}>
                  {waits ? "wartet auf" : "blockiert"}
                </StatusChip>
                <span className="min-w-0 flex-1 truncate text-[12.5px]" style={{ color: "var(--foreground)" }}>
                  {titleOf(waits ? d.predecessorTaskId : d.successorTaskId)}
                </span>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => removeDependency(d)}
                  aria-label={
                    waits
                      ? `Abhängigkeit von „${titleOf(d.predecessorTaskId)}“ entfernen`
                      : `Blockade von „${titleOf(d.successorTaskId)}“ entfernen`
                  }
                  title={
                    waits
                      ? "Abhängigkeit entfernen"
                      : `Entfernt die Abhängigkeit bei „${titleOf(d.successorTaskId)}“`
                  }
                  className="shrink-0 rounded-lg border border-border p-1 text-muted-foreground hover:text-destructive disabled:opacity-50"
                >
                  <Trash2 className="h-[13px] w-[13px]" />
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-border pt-3">
        <span className="text-[12px]" style={{ color: "var(--muted-foreground)" }}>
          Startet erst nach:
        </span>
        <select
          value={predecessorId}
          onChange={(e) => setPredecessorId(e.target.value)}
          disabled={busy || candidates.length === 0}
          aria-label="Vorgängeraufgabe"
          className="h-7 min-w-0 flex-1 rounded-lg border border-border bg-background px-1.5 text-[12px] text-foreground disabled:opacity-50"
        >
          <option value="">
            {candidates.length === 0 ? "Keine weitere Aufgabe verfügbar" : "Aufgabe wählen…"}
          </option>
          {candidates.map((t) => (
            <option key={t.id} value={t.id}>
              {t.content}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={addDependency}
          disabled={!predecessorId || busy}
          className="inline-flex h-7 shrink-0 items-center gap-1 rounded-lg px-2.5 text-[12px] font-medium disabled:opacity-40"
          style={{ background: "var(--kottke-accent)", color: "var(--accent-ink)" }}
        >
          <Plus className="h-[13px] w-[13px]" />
          Abhängigkeit hinzufügen
        </button>
      </div>
    </div>
  );
}
