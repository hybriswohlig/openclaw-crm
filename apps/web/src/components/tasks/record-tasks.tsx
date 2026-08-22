"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Plus, Check, Circle, Calendar } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { TaskDialog } from "./task-dialog";
import { isToday, isTomorrow, differenceInDays, format } from "date-fns";
import { de } from "date-fns/locale";
import type { TaskKind, OperativeArea, TaskStatus } from "@/lib/project-constants";
import type { Priority } from "@/lib/task-priority";

// C1: mirrors the full TaskJSON shape enrichTasks returns (services/tasks.ts)
// so an edit round-trip through the legacy TaskDialog can carry every field
// back into toTaskJSON instead of it fabricating them. See task-dialog.tsx.
interface Task {
  id: string;
  content: string;
  deadline: string | null;
  isCompleted: boolean;
  completedAt: string | null;
  createdBy: string | null;
  createdAt: string;
  linkedRecords: { id: string; displayName: string; objectSlug: string }[];
  assignees: { id: string; name: string; email: string }[];
  sprintId: string | null;
  description: string | null;
  priority: Priority | null;
  parentTaskId: string | null;
  kind: TaskKind;
  projectId: string | null;
  projectName: string | null;
  phaseId: string | null;
  area: OperativeArea | null;
  status: TaskStatus;
  startDate: string | null;
}

interface RecordTasksProps {
  objectSlug: string;
  recordId: string;
  recordDisplayName?: string;
}

function getRelativeDate(deadline: string): {
  label: string;
  color: string;
} {
  const d = new Date(deadline);
  if (isToday(d)) return { label: "Heute", color: "text-orange-400" };
  if (isTomorrow(d)) return { label: "Morgen", color: "text-orange-400" };
  const days = differenceInDays(d, new Date());
  if (days < 0) return { label: "Überfällig", color: "text-destructive" };
  if (days <= 7) return { label: format(d, "EEEE", { locale: de }), color: "text-muted-foreground" };
  return { label: format(d, "d. MMM", { locale: de }), color: "text-muted-foreground" };
}

export function RecordTasks({
  objectSlug,
  recordId,
  recordDisplayName,
}: RecordTasksProps) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentUserId, setCurrentUserId] = useState<string | undefined>();

  // Dialog state
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogMode, setDialogMode] = useState<"create" | "edit">("create");
  const [editingTask, setEditingTask] = useState<Task | null>(null);

  const fetchTasks = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/v1/objects/${objectSlug}/records/${recordId}/tasks`
      );
      if (res.ok) {
        const data = await res.json();
        setTasks(data.data);
      }
    } finally {
      setLoading(false);
    }
  }, [objectSlug, recordId]);

  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

  useEffect(() => {
    fetch("/api/auth/get-session")
      .then((r) => r.json())
      .then((data) => {
        if (data?.user) setCurrentUserId(data.user.id);
      })
      .catch(() => {});
  }, []);

  async function toggleComplete(taskId: string, isCompleted: boolean) {
    setTasks((prev) =>
      prev.map((t) =>
        t.id === taskId ? { ...t, isCompleted: !isCompleted } : t
      )
    );
    await fetch(`/api/v1/tasks/${taskId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isCompleted: !isCompleted }),
    });
  }

  // Prefill state for Quick-Action chips. Cleared whenever the dialog
  // closes so a normal "Add task" click after a Quick-Action doesn't
  // re-use stale defaults.
  const [prefillContent, setPrefillContent] = useState<string | undefined>();
  const [prefillDeadline, setPrefillDeadline] = useState<Date | null>(null);
  const [prefillArea, setPrefillArea] = useState<string | null>(null);

  function openCreateDialog() {
    setDialogMode("create");
    setEditingTask(null);
    setPrefillContent(undefined);
    setPrefillDeadline(null);
    setPrefillArea(null);
    setDialogOpen(true);
  }

  function openQuickAction(content: string, deadline: Date | null, area: string | null) {
    setDialogMode("create");
    setEditingTask(null);
    setPrefillContent(content);
    setPrefillDeadline(deadline);
    setPrefillArea(area);
    setDialogOpen(true);
  }

  function openEditDialog(task: Task) {
    setDialogMode("edit");
    setEditingTask(task);
    setDialogOpen(true);
  }

  async function handleSave(data: {
    content: string;
    deadline: string | null;
    recordIds: string[];
    assigneeIds: string[];
    kind: "projekt" | "operativ";
    area: string | null;
  }) {
    if (dialogMode === "create") {
      const res = await fetch("/api/v1/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(
          err?.error?.message || "Speichern fehlgeschlagen, bitte erneut versuchen"
        );
      }
    } else if (editingTask) {
      const res = await fetch(`/api/v1/tasks/${editingTask.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(
          err?.error?.message || "Speichern fehlgeschlagen, bitte erneut versuchen"
        );
      }
    }
    fetchTasks();
  }

  async function handleDelete() {
    if (!editingTask) return;
    const res = await fetch(`/api/v1/tasks/${editingTask.id}`, {
      method: "DELETE",
    });
    if (!res.ok) {
      toast.error("Aufgabe konnte nicht gelöscht werden");
      return;
    }
    toast.success("Aufgabe gelöscht");
    fetchTasks();
  }

  const openTasks = tasks.filter((t) => !t.isCompleted);
  const completedTasks = tasks.filter((t) => t.isCompleted);

  // Quick-Action presets. Only show on deals (Leads) — they're the
  // operational hot path. Each chip seeds content + a sensible default
  // deadline; user can still tweak inside the dialog before saving.
  const isDeal = objectSlug === "deals";
  const QUICK_ACTIONS: Array<{ label: string; content: string; area: string; deadline: () => Date }> = [
    {
      label: "📞 Rückruf",
      content: "Rückruf vereinbaren",
      area: "kunde",
      deadline: () => {
        const d = new Date();
        d.setHours(d.getHours() + 2);
        return d;
      },
    },
    {
      label: "💰 Angebot",
      content: "Angebot erstellen und senden",
      area: "angebot",
      deadline: () => {
        const d = new Date();
        d.setDate(d.getDate() + 1);
        d.setHours(17, 0, 0, 0);
        return d;
      },
    },
    {
      label: "🚛 Crew einteilen",
      content: "Crew + Transporter für den Umzug einteilen",
      area: "auftrag",
      deadline: () => {
        const d = new Date();
        d.setDate(d.getDate() + 3);
        return d;
      },
    },
    {
      label: "✉️ Bestätigung",
      content: "Bestätigung senden",
      area: "auftrag",
      deadline: () => {
        const d = new Date();
        d.setHours(d.getHours() + 4);
        return d;
      },
    },
  ];

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">Aufgaben</h3>
        <Button
          variant="ghost"
          size="sm"
          onClick={openCreateDialog}
          className="text-xs"
        >
          <Plus className="mr-1 h-3.5 w-3.5" />
          Aufgabe hinzufügen
        </Button>
      </div>

      {isDeal && (
        <div className="flex flex-wrap gap-1.5">
          {QUICK_ACTIONS.map((qa) => (
            <button
              key={qa.label}
              type="button"
              onClick={() => openQuickAction(qa.content, qa.deadline(), qa.area)}
              className="inline-flex items-center gap-1 rounded-full border border-input bg-muted/30 px-2.5 py-1 text-[12px] hover:bg-background transition-colors"
            >
              {qa.label}
            </button>
          ))}
        </div>
      )}

      {loading && tasks.length === 0 && (
        <p className="text-xs text-muted-foreground py-4 text-center">
          Lade…
        </p>
      )}

      {!loading && tasks.length === 0 && (
        <p className="text-xs text-muted-foreground py-4 text-center">
          Noch keine Aufgaben
        </p>
      )}

      <div className="space-y-1">
        {openTasks.map((task) => {
          const dateInfo = task.deadline
            ? getRelativeDate(task.deadline)
            : null;
          return (
            <div
              key={task.id}
              className="group flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-muted/30 cursor-pointer"
              onClick={() => openEditDialog(task)}
            >
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  toggleComplete(task.id, task.isCompleted);
                }}
                className="shrink-0"
              >
                <Circle className="h-4 w-4 text-muted-foreground hover:text-primary transition-colors" />
              </button>
              <span className="text-sm flex-1 truncate">{task.content}</span>
              {dateInfo && (
                <span
                  className={cn(
                    "text-xs flex items-center gap-1 shrink-0",
                    dateInfo.color
                  )}
                >
                  <Calendar className="h-3 w-3" />
                  {dateInfo.label}
                </span>
              )}
            </div>
          );
        })}
      </div>

      {completedTasks.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground pt-2">
            Erledigt ({completedTasks.length})
          </p>
          {completedTasks.map((task) => (
            <div
              key={task.id}
              className="group flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-muted/30 cursor-pointer"
              onClick={() => openEditDialog(task)}
            >
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  toggleComplete(task.id, task.isCompleted);
                }}
                className="shrink-0"
              >
                <div className="h-4 w-4 rounded-full bg-primary flex items-center justify-center">
                  <Check className="h-2.5 w-2.5 text-primary-foreground" />
                </div>
              </button>
              <span className="text-sm flex-1 truncate line-through text-muted-foreground">
                {task.content}
              </span>
            </div>
          ))}
        </div>
      )}

      <TaskDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        mode={dialogMode}
        currentUserId={currentUserId}
        defaultRecordId={recordId}
        defaultRecordName={recordDisplayName}
        defaultRecordSlug={objectSlug}
        defaultContent={prefillContent}
        defaultDeadline={prefillDeadline}
        defaultArea={prefillArea}
        initialData={
          editingTask
            ? {
                id: editingTask.id,
                content: editingTask.content,
                deadline: editingTask.deadline
                  ? new Date(editingTask.deadline)
                  : null,
                assigneeIds: editingTask.assignees.map((a) => a.id),
                recordIds: editingTask.linkedRecords.map((r) => r.id),
                linkedRecords: editingTask.linkedRecords,
                assignees: editingTask.assignees,
                createdBy: editingTask.createdBy,
                createdAt: editingTask.createdAt,
                isCompleted: editingTask.isCompleted,
                completedAt: editingTask.completedAt,
                sprintId: editingTask.sprintId,
                description: editingTask.description,
                priority: editingTask.priority,
                parentTaskId: editingTask.parentTaskId,
                kind: editingTask.kind,
                projectId: editingTask.projectId,
                projectName: editingTask.projectName,
                phaseId: editingTask.phaseId,
                area: editingTask.area,
                status: editingTask.status,
                startDate: editingTask.startDate,
              }
            : undefined
        }
        onSave={handleSave}
        onDelete={dialogMode === "edit" ? handleDelete : undefined}
      />
    </div>
  );
}
