"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { Clock, Plus, Truck, AlignLeft } from "lucide-react";
import { TaskDialog } from "./task-dialog";
import { priorityMeta, PRIORITIES } from "@/lib/task-priority";

interface TaskAssignee {
  id: string;
  name: string;
  email: string;
}

interface TaskLinkedRecord {
  id: string;
  displayName: string;
  objectSlug: string;
}

interface ApiTask {
  id: string;
  content: string;
  deadline: string | null;
  isCompleted: boolean;
  completedAt: string | null;
  createdBy: string | null;
  createdAt: string;
  linkedRecords: TaskLinkedRecord[];
  assignees: TaskAssignee[];
  kanbanStatus: ColumnKey | null;
  pointEstimate: number | null;
  sprintId: string | null;
  workType: string | null;
  growthCategory: string | null;
  description: string | null;
  priority: string | null;
}

type ColumnKey = "backlog" | "heute" | "laeuft" | "warte" | "erledigt";

const COLUMNS: { key: ColumnKey; label: string; hint: string; live?: boolean }[] = [
  { key: "backlog", label: "Backlog", hint: "Noch nicht geplant" },
  { key: "heute", label: "Heute", hint: "In Arbeit heute" },
  { key: "laeuft", label: "Läuft jetzt", hint: "Vor Ort / aktiv", live: true },
  { key: "warte", label: "Wartet", hint: "Auf Kunde/Partner" },
  { key: "erledigt", label: "Erledigt", hint: "Diese Woche" },
];

function isSameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function classifyTask(t: ApiTask): ColumnKey {
  // Explicit column wins — set by drag-drop. We still honour isCompleted
  // for the "erledigt" terminal state because completing a task should
  // also move it visually, even if it had a different kanbanStatus.
  if (t.isCompleted) return "erledigt";
  if (t.kanbanStatus && COLUMNS.some((c) => c.key === t.kanbanStatus))
    return t.kanbanStatus as ColumnKey;
  // Derivation fallback for tasks that have never been dragged.
  if (t.deadline) {
    const d = new Date(t.deadline);
    const now = new Date();
    if (isSameDay(d, now)) return "heute";
    if (d.getTime() < now.getTime()) return "laeuft";
    return "backlog";
  }
  if (t.linkedRecords.length > 0) return "warte";
  return "backlog";
}

function todayISO(): string {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  return d.toISOString();
}

function nowISO(): string {
  return new Date().toISOString();
}

function formatDue(t: ApiTask): string {
  if (!t.deadline) return "—";
  const d = new Date(t.deadline);
  const now = new Date();
  if (isSameDay(d, now)) {
    return `Heute ${d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })}`;
  }
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  if (isSameDay(d, tomorrow)) return "Morgen";
  return d.toLocaleDateString("de-DE", { weekday: "short", day: "numeric", month: "numeric" });
}

function avatarClassFor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0;
  const palette = ["a1", "a2", "a3"];
  return palette[Math.abs(hash) % palette.length];
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

interface SprintLite {
  id: string;
  name: string;
  state: string;
}

type SprintScope = "alle" | "sprint" | "backlog";

export function TaskKanban({
  refreshKey,
  onMutate,
}: {
  refreshKey?: number;
  onMutate?: () => void;
} = {}) {
  const [tasks, setTasks] = useState<ApiTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>("alle");
  const [sprintScope, setSprintScope] = useState<SprintScope>("alle");
  const [sprints, setSprints] = useState<SprintLite[]>([]);
  const [activeDragId, setActiveDragId] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogMode, setDialogMode] = useState<"create" | "edit">("edit");
  const [editingTask, setEditingTask] = useState<ApiTask | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | undefined>(undefined);

  const activeSprint = useMemo(
    () => sprints.find((s) => s.state === "aktiv") ?? null,
    [sprints]
  );
  const sprintNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of sprints) m.set(s.id, s.name);
    return m;
  }, [sprints]);
  // While scoped to the active sprint, every card is in that sprint, so the
  // sprint chip is pure noise — suppress it by passing an empty name map.
  const emptyMap = useMemo(() => new Map<string, string>(), []);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      // 6px so the small fingertip wobble between mousedown and a fast
      // tap doesn't kick off a drag — opening the dialog stays cheap.
      activationConstraint: { distance: 6 },
    })
  );

  // Current user for the dialog's assignee defaulting + "(You)" badge.
  useEffect(() => {
    fetch("/api/auth/get-session")
      .then((r) => r.json())
      .then((data) => {
        if (data?.user?.id) setCurrentUserId(data.user.id);
      })
      .catch(() => {});
  }, []);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/tasks?showCompleted=true&limit=200");
      if (!res.ok) return;
      const data = await res.json();
      const list = (data?.data?.tasks ?? data?.tasks ?? []) as ApiTask[];
      setTasks(list);
    } catch {
      // swallow
    } finally {
      setLoading(false);
    }
  }, []);

  const loadSprints = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/sprints", { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      setSprints((data?.data?.sprints ?? []) as SprintLite[]);
    } catch {
      // swallow
    }
  }, []);

  useEffect(() => {
    load();
    loadSprints();
  }, [load, loadSprints, refreshKey]);

  // Bubble mutations up so the Sprint-Bar refreshes too; fall back to a
  // local reload when used standalone.
  const reload = useCallback(() => {
    if (onMutate) onMutate();
    else load();
  }, [onMutate, load]);

  const allAssignees = useMemo(() => {
    const map = new Map<string, TaskAssignee>();
    for (const t of tasks) {
      for (const a of t.assignees) if (!map.has(a.id)) map.set(a.id, a);
    }
    return Array.from(map.values());
  }, [tasks]);

  const filtered = useMemo(() => {
    let list = tasks;
    // Sprint scope: focus the board on the active sprint, the product
    // backlog, or show everything (the default).
    if (sprintScope === "sprint") {
      list = activeSprint
        ? list.filter((t) => t.sprintId === activeSprint.id)
        : [];
    } else if (sprintScope === "backlog") {
      list = list.filter((t) => !t.sprintId);
    }
    // Assignee filter.
    if (filter === "mine") {
      if (!currentUserId) return list;
      return list.filter((t) => t.assignees.some((a) => a.id === currentUserId));
    }
    if (filter !== "alle") {
      return list.filter((t) => t.assignees.some((a) => a.id === filter));
    }
    return list;
  }, [tasks, filter, currentUserId, sprintScope, activeSprint]);

  // Unread "my open" count — drives the orange dot on the "Mir zugewiesen"
  // pill so you can see at a glance how many open tasks are on your plate.
  const myOpenCount = useMemo(() => {
    if (!currentUserId) return 0;
    return tasks.filter(
      (t) =>
        !t.isCompleted && t.assignees.some((a) => a.id === currentUserId)
    ).length;
  }, [tasks, currentUserId]);

  const byColumn = useMemo(() => {
    const m: Record<ColumnKey, ApiTask[]> = {
      backlog: [],
      heute: [],
      laeuft: [],
      warte: [],
      erledigt: [],
    };
    for (const t of filtered) m[classifyTask(t)].push(t);
    return m;
  }, [filtered]);

  async function moveTaskTo(taskId: string, target: ColumnKey) {
    const t = tasks.find((x) => x.id === taskId);
    if (!t) return;
    const current = classifyTask(t);
    if (current === target) return;

    // Always write the explicit kanbanStatus so the column placement
    // sticks no matter what the derivation would say. "erledigt" also
    // flips isCompleted=true (terminal semantic), every other column
    // implicitly opens the task back up if it was completed.
    const updates: Record<string, unknown> = { kanbanStatus: target };
    if (target === "erledigt") {
      updates.isCompleted = true;
    } else if (t.isCompleted) {
      updates.isCompleted = false;
    }
    // "heute" still nudges the deadline so the daily overdue cron has
    // a sensible value to compare against — but the kanban placement
    // no longer depends on it.
    if (target === "heute" && !t.deadline) {
      updates.deadline = todayISO();
    }

    // Optimistic update
    setTasks((prev) =>
      prev.map((x) =>
        x.id === taskId
          ? {
              ...x,
              kanbanStatus: target,
              isCompleted:
                "isCompleted" in updates ? !!updates.isCompleted : x.isCompleted,
              deadline:
                "deadline" in updates
                  ? (updates.deadline as string | null)
                  : x.deadline,
            }
          : x
      )
    );

    try {
      const res = await fetch(`/api/v1/tasks/${taskId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      // On success keep the optimistic state but nudge the Sprint-Bar so
      // its done-points reflect a card dragged into / out of "erledigt".
      if (!res.ok) load();
      else onMutate?.();
    } catch {
      load();
    }
  }

  function handleDragStart(e: DragStartEvent) {
    setActiveDragId(String(e.active.id));
  }

  function handleDragEnd(e: DragEndEvent) {
    setActiveDragId(null);
    const overId = e.over?.id;
    if (!overId) return;
    const target = String(overId) as ColumnKey;
    if (!COLUMNS.some((c) => c.key === target)) return;
    moveTaskTo(String(e.active.id), target);
  }

  const activeTask = activeDragId ? tasks.find((t) => t.id === activeDragId) : null;

  return (
    <div
      style={{
        padding: "12px 36px 36px",
        display: "flex",
        flexDirection: "column",
        gap: 12,
      }}
      className="k-paper-noise"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <span
            style={{
              fontFamily: "var(--f-mono)",
              fontSize: 11,
              letterSpacing: ".04em",
              color: "var(--ink-muted)",
            }}
          >
            {tasks.length} Aufgaben · {byColumn.laeuft.length} läuft · {byColumn.heute.length} heute
          </span>
          {/* Priority legend — decode the card colours, like a Kanban board. */}
          <span
            className="flex items-center gap-2.5"
            style={{ fontSize: 11, color: "var(--ink-muted)" }}
          >
            {PRIORITIES.map((p) => (
              <span key={p.value} className="inline-flex items-center gap-1">
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    background: p.dot,
                    display: "inline-block",
                  }}
                />
                {p.label}
              </span>
            ))}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          {/* Sprint scope — focus the board on the active sprint or the
              product backlog. Default "Alle" shows everything (flow + sprint),
              so the board behaves exactly as before unless you opt in. */}
          <div
            style={{
              display: "inline-flex",
              background: "#fff",
              borderRadius: 10,
              border: "1px solid var(--line)",
              padding: 3,
            }}
          >
            <FilterPill
              active={sprintScope === "sprint"}
              onClick={() => setSprintScope("sprint")}
            >
              Aktiver Sprint
            </FilterPill>
            <FilterPill
              active={sprintScope === "backlog"}
              onClick={() => setSprintScope("backlog")}
            >
              Backlog
            </FilterPill>
            <FilterPill
              active={sprintScope === "alle"}
              onClick={() => setSprintScope("alle")}
            >
              Alle
            </FilterPill>
          </div>
          <div
            style={{
              display: "inline-flex",
              background: "#fff",
              borderRadius: 10,
              border: "1px solid var(--line)",
              padding: 3,
            }}
          >
            <FilterPill
              active={filter === "mine"}
              onClick={() => setFilter("mine")}
            >
              Mir zugewiesen
              {myOpenCount > 0 && (
                <span
                  style={{
                    marginLeft: 6,
                    background:
                      filter === "mine" ? "var(--paper)" : "var(--kottke-accent)",
                    color: filter === "mine" ? "var(--ink)" : "var(--paper)",
                    fontSize: 10,
                    fontWeight: 600,
                    padding: "1px 6px",
                    borderRadius: 999,
                  }}
                >
                  {myOpenCount}
                </span>
              )}
            </FilterPill>
            <FilterPill active={filter === "alle"} onClick={() => setFilter("alle")}>
              Alle
            </FilterPill>
            {allAssignees.slice(0, 5).map((a) => (
              <FilterPill
                key={a.id}
                active={filter === a.id}
                onClick={() => setFilter(a.id)}
              >
                {a.name.split(/\s+/)[0]}
              </FilterPill>
            ))}
          </div>
          <button
            className="k-btn primary sm"
            onClick={() => {
              setDialogMode("create");
              setEditingTask(null);
              setDialogOpen(true);
            }}
          >
            <Plus size={13} />
            Neue Aufgabe
          </button>
        </div>
      </div>

      <DndContext
        sensors={sensors}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <div
          className="k-scroll"
          style={{
            display: "flex",
            gap: 12,
            overflowX: "auto",
            paddingBottom: 8,
          }}
        >
          {COLUMNS.map((col) => (
            <KanbanColumn
              key={col.key}
              col={col}
              tasks={byColumn[col.key]}
              loading={loading}
              sprintNameById={sprintScope === "sprint" ? emptyMap : sprintNameById}
              onTaskClick={(t) => {
                setDialogMode("edit");
                setEditingTask(t);
                setDialogOpen(true);
              }}
            />
          ))}
        </div>

        <DragOverlay>
          {activeTask ? <TaskCard task={activeTask} dragging /> : null}
        </DragOverlay>
      </DndContext>

      <TaskDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        mode={dialogMode}
        currentUserId={currentUserId}
        // When the board is scoped to the active sprint, new tasks land in
        // that sprint by default.
        defaultSprintId={
          dialogMode === "create" && sprintScope === "sprint" && activeSprint
            ? activeSprint.id
            : null
        }
        initialData={
          editingTask
            ? {
                id: editingTask.id,
                content: editingTask.content,
                deadline: editingTask.deadline ? new Date(editingTask.deadline) : null,
                assigneeIds: editingTask.assignees.map((a) => a.id),
                recordIds: editingTask.linkedRecords.map((r) => r.id),
                linkedRecords: editingTask.linkedRecords,
                assignees: editingTask.assignees,
                pointEstimate: editingTask.pointEstimate ?? null,
                sprintId: editingTask.sprintId,
                workType: editingTask.workType,
                growthCategory: editingTask.growthCategory,
                description: editingTask.description,
                priority: editingTask.priority,
                kanbanStatus: editingTask.kanbanStatus,
                createdBy: editingTask.createdBy,
                createdAt: editingTask.createdAt,
              }
            : undefined
        }
        onSave={async (data) => {
          if (dialogMode === "create") {
            await fetch("/api/v1/tasks", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(data),
            });
          } else if (editingTask) {
            await fetch(`/api/v1/tasks/${editingTask.id}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(data),
            });
          }
          reload();
        }}
        onDelete={
          dialogMode === "edit" && editingTask
            ? async () => {
                await fetch(`/api/v1/tasks/${editingTask.id}`, {
                  method: "DELETE",
                });
                reload();
              }
            : undefined
        }
      />

      <style>{`@keyframes pulse { 0%{opacity:1; transform:scale(1);} 50%{opacity:.4; transform:scale(1.2);} 100%{opacity:1; transform:scale(1);} }`}</style>
    </div>
  );
}

function FilterPill({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        border: 0,
        background: active ? "var(--ink)" : "transparent",
        color: active ? "var(--paper)" : "var(--ink-soft)",
        padding: "6px 11px",
        borderRadius: 7,
        fontSize: 12.5,
        fontWeight: 500,
        cursor: "pointer",
        fontFamily: "inherit",
      }}
    >
      {children}
    </button>
  );
}

function KanbanColumn({
  col,
  tasks,
  loading,
  sprintNameById,
  onTaskClick,
}: {
  col: { key: ColumnKey; label: string; hint: string; live?: boolean };
  tasks: ApiTask[];
  loading: boolean;
  sprintNameById: Map<string, string>;
  onTaskClick: (t: ApiTask) => void;
}) {
  const { isOver, setNodeRef } = useDroppable({ id: col.key });
  return (
    <div
      style={{
        minWidth: 240,
        flex: "1 1 0",
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      <div className="flex items-center justify-between" style={{ padding: "4px 6px" }}>
        <div className="flex items-center gap-2">
          {col.live && (
            <span
              style={{
                width: 7,
                height: 7,
                borderRadius: "50%",
                background: "var(--kottke-accent)",
                animation: "pulse 1.8s ease-out infinite",
              }}
            />
          )}
          <span style={{ fontFamily: "var(--f-display)", fontSize: 15, fontWeight: 500 }}>
            {col.label}
          </span>
          <span
            style={{
              fontSize: 11,
              color: "var(--ink-muted)",
              fontFamily: "var(--f-mono)",
              padding: "1px 7px",
              background: "rgba(34,29,22,.06)",
              borderRadius: 999,
            }}
          >
            {tasks.length}
          </span>
        </div>
      </div>
      <div
        style={{
          fontSize: 11,
          color: "var(--ink-muted)",
          padding: "0 6px",
          marginTop: -6,
          fontFamily: "var(--f-mono)",
        }}
      >
        {col.hint}
      </div>
      <div
        ref={setNodeRef}
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 8,
          minHeight: 60,
          borderRadius: 12,
          padding: isOver ? 4 : 0,
          background: isOver ? "color-mix(in srgb, var(--kottke-accent) 8%, transparent)" : "transparent",
          transition: "background .15s, padding .15s",
        }}
      >
        {loading && tasks.length === 0 ? (
          <div
            style={{
              padding: 10,
              fontSize: 12,
              color: "var(--ink-muted)",
              fontStyle: "italic",
            }}
          >
            Lade…
          </div>
        ) : null}
        {tasks.map((t) => (
          <DraggableTaskCard
            key={t.id}
            task={t}
            sprintName={t.sprintId ? sprintNameById.get(t.sprintId) : undefined}
            onClick={() => onTaskClick(t)}
          />
        ))}
        {!loading && tasks.length === 0 && (
          <div
            style={{
              borderRadius: 10,
              border: "1px dashed var(--line, #e7e2d9)",
              padding: "14px 10px",
              textAlign: "center",
              fontSize: 11,
              color: "var(--ink-muted)",
              fontFamily: "var(--f-mono)",
            }}
          >
            Hierher ziehen
          </div>
        )}
      </div>
    </div>
  );
}

function DraggableTaskCard({
  task,
  sprintName,
  onClick,
}: {
  task: ApiTask;
  sprintName?: string;
  onClick: () => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: task.id });

  // dnd-kit's listeners are spread onto the OUTER wrapper so its drag
  // detection (pointerdown / pointermove with 6px activation distance)
  // stays intact. The click target sits one level deeper — when the user
  // taps without moving, no drag activates, and the synthesized click on
  // the inner element fires normally. If a drag DID activate, dnd-kit
  // absorbs the pointer events and no click is synthesized, so we never
  // open the dialog after dropping a card.
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      style={{
        opacity: isDragging ? 0.3 : 1,
        cursor: isDragging ? "grabbing" : "pointer",
        touchAction: "none",
      }}
    >
      <TaskCard
        task={task}
        sprintName={sprintName}
        onCardClick={() => {
          if (!isDragging) onClick();
        }}
      />
    </div>
  );
}

function TaskCard({
  task,
  dragging,
  sprintName,
  onCardClick,
}: {
  task: ApiTask;
  dragging?: boolean;
  sprintName?: string;
  onCardClick?: () => void;
}) {
  const done = task.isCompleted;
  const live =
    !done &&
    task.deadline !== null &&
    new Date(task.deadline).getTime() < Date.now() &&
    !isSameDay(new Date(task.deadline), new Date());
  const assignee = task.assignees[0];
  const linkedDeal = task.linkedRecords.find((r) => r.objectSlug === "deals");
  const prio = priorityMeta(task.priority);
  const hasDescription = !!task.description && task.description.trim().length > 0;

  // Priority-tinted box (like a Kanban template): a soft wash of the
  // priority colour + a matching border + a corner dot. Completed cards stay
  // muted so "done" still reads as done.
  const cardBorder =
    done
      ? "1px solid var(--line)"
      : prio
        ? `1px solid color-mix(in srgb, ${prio.dot} 38%, transparent)`
        : live
          ? "1px solid color-mix(in oklch, var(--kottke-accent) 30%, transparent)"
          : "1px solid var(--line)";
  const cardBg = done
    ? "color-mix(in srgb, var(--paper) 60%, #fff)"
    : prio
      ? `color-mix(in srgb, ${prio.dot} 9%, #fff)`
      : "#fff";

  return (
    <div
      className="k-card"
      onClick={onCardClick}
      style={{
        position: "relative",
        padding: 12,
        cursor: dragging ? "grabbing" : onCardClick ? "pointer" : "grab",
        border: cardBorder,
        background: cardBg,
        boxShadow: dragging ? "0 12px 32px -8px rgba(34,29,22,.25)" : undefined,
      }}
    >
      {prio && (
        <span
          title={`Prioritaet: ${prio.label}`}
          style={{
            position: "absolute",
            top: 11,
            right: 11,
            width: 9,
            height: 9,
            borderRadius: "50%",
            background: prio.dot,
            opacity: done ? 0.45 : 1,
            boxShadow: done ? "none" : `0 0 0 2px color-mix(in srgb, ${prio.dot} 18%, transparent)`,
          }}
        />
      )}
      <div
        style={{
          fontWeight: 500,
          fontSize: 13.5,
          lineHeight: 1.35,
          paddingRight: prio ? 14 : 0,
          textDecoration: done ? "line-through" : "none",
          color: done ? "var(--ink-muted)" : "var(--ink)",
        }}
      >
        {task.content}
      </div>

      {(task.pointEstimate != null || sprintName) && (
        <div className="flex flex-wrap items-center gap-1.5" style={{ marginTop: 6 }}>
          {task.pointEstimate != null && (
            <span
              className="k-chip"
              style={{
                padding: "1px 7px",
                fontSize: 10,
                fontFamily: "var(--f-mono)",
                background: "var(--accent-soft, rgba(16,185,129,0.12))",
                color: "var(--accent, #047857)",
                border: "1px solid var(--accent-line, rgba(16,185,129,0.3))",
              }}
              title="Fibonacci-Größe — zählt für den Team-Pulse"
            >
              {task.pointEstimate}p
            </span>
          )}
          {sprintName && (
            <span
              className="k-chip"
              style={{
                padding: "1px 7px",
                fontSize: 10,
                fontFamily: "var(--f-mono)",
                background: "color-mix(in srgb, var(--kottke-accent, #c2410c) 12%, transparent)",
                color: "var(--kottke-accent, #c2410c)",
                border: "1px solid color-mix(in srgb, var(--kottke-accent, #c2410c) 30%, transparent)",
              }}
              title="Sprint"
            >
              {sprintName.slice(0, 16)}
            </span>
          )}
        </div>
      )}

      {(linkedDeal || task.linkedRecords.length > 0) && (
        <div className="flex flex-wrap gap-1.5" style={{ marginTop: 10 }}>
          {linkedDeal && (
            <span
              className="k-chip"
              style={{ padding: "1px 7px", fontSize: 10, fontFamily: "var(--f-mono)" }}
            >
              <Truck size={9} />
              {linkedDeal.displayName.slice(0, 14)}
            </span>
          )}
          {!linkedDeal &&
            task.linkedRecords.slice(0, 2).map((r) => (
              <span
                key={r.id}
                className="k-chip"
                style={{ padding: "1px 7px", fontSize: 10 }}
              >
                {r.displayName.slice(0, 16)}
              </span>
            ))}
        </div>
      )}

      <div
        className="flex items-center justify-between"
        style={{
          marginTop: 10,
          paddingTop: 10,
          borderTop: "1px dashed var(--line)",
        }}
      >
        <span
          style={{
            fontSize: 11,
            color: "var(--ink-muted)",
            fontFamily: "var(--f-mono)",
            display: "inline-flex",
            alignItems: "center",
            gap: 5,
          }}
        >
          <span style={{ opacity: 0.6 }}>T-{task.id.slice(0, 4)}</span>
          {hasDescription && (
            <AlignLeft size={10} aria-label="Beschreibung vorhanden" />
          )}
          <Clock size={10} />
          {formatDue(task)}
        </span>
        {assignee ? (
          <span
            className={`k-avatar ${avatarClassFor(assignee.name)}`}
            style={{ width: 20, height: 20, fontSize: 10 }}
            title={assignee.name}
          >
            {initials(assignee.name)}
          </span>
        ) : null}
      </div>
    </div>
  );
}
