"use client";

// Sprint planning: pull tasks from the Produkt-Backlog into the
// Sprint-Backlog and back. Pure assignment of tasks.sprintId — no new
// concepts. Opened from the Sprint-Bar.
import { useCallback, useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { ArrowRight, ArrowLeft, Loader2 } from "lucide-react";

interface PlanningTask {
  id: string;
  content: string;
  pointEstimate: number | null;
  assignees: { id: string; name: string }[];
}

interface SprintPlanningProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sprint: { id: string; name: string; capacityPoints: number | null };
  onMutate: () => void;
}

function pts(t: PlanningTask): number {
  return t.pointEstimate ?? 1;
}

export function SprintPlanning({
  open,
  onOpenChange,
  sprint,
  onMutate,
}: SprintPlanningProps) {
  const [backlog, setBacklog] = useState<PlanningTask[]>([]);
  const [inSprint, setInSprint] = useState<PlanningTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [b, s] = await Promise.all([
        fetch("/api/v1/tasks?sprintId=none&limit=200").then((r) => r.json()),
        fetch(`/api/v1/tasks?sprintId=${sprint.id}&limit=200`).then((r) =>
          r.json()
        ),
      ]);
      setBacklog((b?.data?.tasks ?? []) as PlanningTask[]);
      setInSprint((s?.data?.tasks ?? []) as PlanningTask[]);
    } catch {
      // swallow
    } finally {
      setLoading(false);
    }
  }, [sprint.id]);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  async function move(task: PlanningTask, toSprint: boolean) {
    setBusyId(task.id);
    // Optimistic move between columns.
    if (toSprint) {
      setBacklog((prev) => prev.filter((t) => t.id !== task.id));
      setInSprint((prev) => [task, ...prev]);
    } else {
      setInSprint((prev) => prev.filter((t) => t.id !== task.id));
      setBacklog((prev) => [task, ...prev]);
    }
    try {
      await fetch(`/api/v1/tasks/${task.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sprintId: toSprint ? sprint.id : null }),
      });
      onMutate();
    } catch {
      load();
    } finally {
      setBusyId(null);
    }
  }

  const committed = inSprint.reduce((s, t) => s + pts(t), 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Sprint planen · {sprint.name}</DialogTitle>
          <DialogDescription>
            Aufgaben aus dem Produkt-Backlog in den Sprint ziehen. Geplant:{" "}
            {committed}
            {sprint.capacityPoints != null
              ? ` von ${sprint.capacityPoints} Punkten Kapazitaet`
              : " Punkte"}
            .
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-10 text-sm text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Lade Aufgaben…
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Column
              title="Produkt-Backlog"
              hint="Noch keinem Sprint zugeordnet"
              tasks={backlog}
              busyId={busyId}
              actionIcon={<ArrowRight className="h-3.5 w-3.5" />}
              actionTitle="In den Sprint"
              onAction={(t) => move(t, true)}
            />
            <Column
              title="Sprint-Backlog"
              hint={`${inSprint.length} Aufgaben · ${committed} Punkte`}
              tasks={inSprint}
              busyId={busyId}
              actionIcon={<ArrowLeft className="h-3.5 w-3.5" />}
              actionTitle="Zurueck ins Backlog"
              onAction={(t) => move(t, false)}
              reverse
            />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Column({
  title,
  hint,
  tasks,
  busyId,
  actionIcon,
  actionTitle,
  onAction,
  reverse,
}: {
  title: string;
  hint: string;
  tasks: PlanningTask[];
  busyId: string | null;
  actionIcon: React.ReactNode;
  actionTitle: string;
  onAction: (t: PlanningTask) => void;
  reverse?: boolean;
}) {
  return (
    <div className="rounded-lg border border-border bg-muted/10 p-2">
      <div className="px-1 pb-2">
        <div className="text-sm font-medium">{title}</div>
        <div className="text-[11px] text-muted-foreground">{hint}</div>
      </div>
      <div className="max-h-[50vh] space-y-1 overflow-auto">
        {tasks.length === 0 && (
          <p className="px-2 py-6 text-center text-xs text-muted-foreground">
            Keine Aufgaben
          </p>
        )}
        {tasks.map((t) => (
          <div
            key={t.id}
            className="flex items-center gap-2 rounded-md border border-border bg-background px-2 py-1.5"
          >
            {reverse && (
              <ActionButton
                busy={busyId === t.id}
                title={actionTitle}
                icon={actionIcon}
                onClick={() => onAction(t)}
              />
            )}
            <span className="flex-1 truncate text-xs">{t.content}</span>
            <span className="shrink-0 rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-emerald-700">
              {t.pointEstimate ?? 1}p
            </span>
            {!reverse && (
              <ActionButton
                busy={busyId === t.id}
                title={actionTitle}
                icon={actionIcon}
                onClick={() => onAction(t)}
              />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function ActionButton({
  busy,
  title,
  icon,
  onClick,
}: {
  busy: boolean;
  title: string;
  icon: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={busy}
      onClick={onClick}
      className="shrink-0 rounded border border-border p-1 text-muted-foreground hover:bg-muted/50 hover:text-foreground disabled:opacity-50"
    >
      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : icon}
    </button>
  );
}
