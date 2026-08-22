"use client";

// Tasks tab: every task of the project, grouped by phase (Arbeitsbereich),
// with the phase-less ones in their own bucket. Subtasks are included
// because the progress counts include them (Spec §6).
import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { useSession } from "@/lib/auth-client";
import type { PhaseJSON, ProjectJSON, TaskJSON, TaskListJSON } from "@/lib/work-types";
import { SectionCard } from "@/components/work/section-card";
import { TaskRow } from "@/components/work/task-row";
import { FilterChips } from "@/components/work/filter-chips";
import { EmptyState, LoadingLine } from "@/components/work/empty-state";
import { ProgressBar } from "@/components/work/progress-bar";
import { WorkTaskDialog, type WorkTaskSavePayload } from "@/components/work/task-dialog";
import { countLabel, readApiError } from "@/lib/work-ui";

type TaskFilter = "alle" | "offen" | "erledigt" | "ueberfaellig";

const FILTERS: Array<{ value: TaskFilter; label: string }> = [
  { value: "alle", label: "Alle" },
  { value: "offen", label: "Offen" },
  { value: "erledigt", label: "Erledigt" },
  { value: "ueberfaellig", label: "Überfällig" },
];

/** The route caps at 200 (plan R7.3). */
const TASK_PAGE_SIZE = 200;

export function TasksTab({ project, reload }: { project: ProjectJSON; reload: () => Promise<void> }) {
  const { data: session } = useSession();
  const [tasks, setTasks] = useState<TaskJSON[]>([]);
  const [total, setTotal] = useState(0);
  const [phases, setPhases] = useState<PhaseJSON[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<TaskFilter>("alle");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<TaskJSON | null>(null);
  const [presetPhaseId, setPresetPhaseId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    // showCompleted=true and includeSubtasks=true are both mandatory: the
    // route defaults to false/parentTaskId IS NULL, and without them the
    // "Erledigt" chip is permanently empty while the phase headers above it
    // (which come from stats, not this fetch) keep showing server truth
    // (defect W3).
    const [t, p] = await Promise.allSettled([
      fetch(
        `/api/v1/tasks?projectId=${project.id}&includeSubtasks=true&showCompleted=true&limit=${TASK_PAGE_SIZE}`,
        { cache: "no-store" }
      ),
      fetch(`/api/v1/projects/${project.id}/phases`, { cache: "no-store" }),
    ]);
    if (t.status === "fulfilled" && t.value.ok) {
      const payload = ((await t.value.json())?.data ?? null) as TaskListJSON | null;
      setTasks(payload?.tasks ?? []);
      setTotal(payload?.pagination?.total ?? payload?.tasks?.length ?? 0);
    }
    if (p.status === "fulfilled" && p.value.ok) {
      setPhases((((await p.value.json())?.data ?? []) as PhaseJSON[]));
    }
    setLoading(false);
  }, [project.id]);

  useEffect(() => {
    load();
  }, [load]);

  const visible = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return tasks.filter((t) => {
      if (filter === "alle") return true;
      if (filter === "offen") return t.status !== "erledigt";
      if (filter === "erledigt") return t.status === "erledigt";
      return t.status !== "erledigt" && !!t.deadline && new Date(t.deadline) < today;
    });
  }, [tasks, filter]);

  const groups = useMemo(() => {
    const byPhase = new Map<string, TaskJSON[]>();
    const loose: TaskJSON[] = [];
    for (const t of visible) {
      if (!t.phaseId) {
        loose.push(t);
        continue;
      }
      const arr = byPhase.get(t.phaseId) ?? [];
      arr.push(t);
      byPhase.set(t.phaseId, arr);
    }
    const out = phases.map((ph) => ({ phase: ph, tasks: byPhase.get(ph.id) ?? [] }));
    return { out, loose };
  }, [visible, phases]);

  async function save(payload: WorkTaskSavePayload) {
    const url = editing ? `/api/v1/tasks/${editing.id}` : "/api/v1/tasks";
    const res = await fetch(url, {
      method: editing ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(await readApiError(res, "Speichern fehlgeschlagen"));
    toast.success(editing ? "Aufgabe aktualisiert" : "Aufgabe erstellt");
    await load();
    await reload();
  }

  function openNew(phaseId: string | null) {
    setEditing(null);
    setPresetPhaseId(phaseId);
    setDialogOpen(true);
  }

  if (loading && tasks.length === 0) return <LoadingLine />;

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <FilterChips
            options={FILTERS.map((f) => ({
              ...f,
              count:
                f.value === "alle"
                  ? tasks.length
                  : f.value === "offen"
                    ? tasks.filter((t) => t.status !== "erledigt").length
                    : f.value === "erledigt"
                      ? tasks.filter((t) => t.status === "erledigt").length
                      : project.stats.overdueTasks,
            }))}
            value={filter}
            onChange={setFilter}
          />
          {total > tasks.length && (
            <span className="k-mono text-[11px]" style={{ color: "var(--warn)" }}>
              {countLabel(tasks.length, total)}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={() => openNew(null)}
          className="inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-[12.5px] font-medium"
          style={{ background: "var(--kottke-accent)", color: "var(--accent-ink)" }}
        >
          <Plus className="h-[13px] w-[13px]" />
          Aufgabe hinzufügen
        </button>
      </div>

      {groups.out.map(({ phase, tasks: phaseTasks }) => (
        <SectionCard
          key={phase.id}
          title={phase.name}
          subtitle={`${phase.doneTasks}/${phase.totalTasks} erledigt`}
          action={
            <button
              type="button"
              onClick={() => openNew(phase.id)}
              className="text-xs"
              style={{ color: "var(--kottke-accent)" }}
            >
              + Aufgabe
            </button>
          }
        >
          <ProgressBar value={phase.progressPct} height={5} className="mb-2" />
          {phaseTasks.length === 0 ? (
            <EmptyState title="Keine Aufgaben in diesem Bereich" />
          ) : (
            <div className="-mx-2 flex flex-col divide-y divide-border">
              {phaseTasks.map((t) => (
                <TaskRow
                  key={t.id}
                  task={t}
                  showProject={false}
                  showArea={false}
                  onOpen={(task) => {
                    setEditing(task);
                    setPresetPhaseId(null);
                    setDialogOpen(true);
                  }}
                  onToggled={async () => {
                    await load();
                    await reload();
                  }}
                />
              ))}
            </div>
          )}
        </SectionCard>
      ))}

      <SectionCard
        title="Ohne Arbeitsbereich"
        subtitle={`${groups.loose.length} Aufgaben`}
        action={
          <button type="button" onClick={() => openNew(null)} className="text-xs" style={{ color: "var(--kottke-accent)" }}>
            + Aufgabe
          </button>
        }
      >
        {groups.loose.length === 0 ? (
          <EmptyState title="Alles einem Bereich zugeordnet" />
        ) : (
          <div className="-mx-2 flex flex-col divide-y divide-border">
            {groups.loose.map((t) => (
              <TaskRow
                key={t.id}
                task={t}
                showProject={false}
                showArea={false}
                onOpen={(task) => {
                  setEditing(task);
                  setPresetPhaseId(null);
                  setDialogOpen(true);
                }}
                onToggled={async () => {
                  await load();
                  await reload();
                }}
              />
            ))}
          </div>
        )}
      </SectionCard>

      <WorkTaskDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        mode={editing ? "edit" : "create"}
        task={editing}
        currentUserId={session?.user?.id}
        defaultKind="projekt"
        defaultProjectId={project.id}
        defaultPhaseId={presetPhaseId}
        onSave={save}
        onDelete={
          editing
            ? async () => {
                await fetch(`/api/v1/tasks/${editing.id}`, { method: "DELETE" });
                toast.success("Aufgabe gelöscht");
                await load();
                await reload();
              }
            : undefined
        }
      />
    </div>
  );
}
