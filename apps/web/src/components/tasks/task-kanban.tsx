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
import { Clock, Plus, Truck } from "lucide-react";
import { TaskDialog } from "./task-dialog";

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
  if (t.isCompleted) return "erledigt";
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

export function TaskKanban() {
  const [tasks, setTasks] = useState<ApiTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>("alle");
  const [activeDragId, setActiveDragId] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogMode, setDialogMode] = useState<"create" | "edit">("edit");
  const [editingTask, setEditingTask] = useState<ApiTask | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | undefined>(undefined);

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

  useEffect(() => {
    load();
  }, [load]);

  const allAssignees = useMemo(() => {
    const map = new Map<string, TaskAssignee>();
    for (const t of tasks) {
      for (const a of t.assignees) if (!map.has(a.id)) map.set(a.id, a);
    }
    return Array.from(map.values());
  }, [tasks]);

  const filtered = useMemo(() => {
    if (filter === "alle") return tasks;
    return tasks.filter((t) => t.assignees.some((a) => a.id === filter));
  }, [tasks, filter]);

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

    const updates: Record<string, unknown> = {};
    if (target === "erledigt") {
      updates.isCompleted = true;
    } else {
      if (t.isCompleted) updates.isCompleted = false;
      if (target === "heute") updates.deadline = todayISO();
      else if (target === "laeuft") updates.deadline = nowISO();
      else if (target === "warte") updates.deadline = null;
      else if (target === "backlog") updates.deadline = null;
    }

    // Optimistic update
    setTasks((prev) =>
      prev.map((x) =>
        x.id === taskId
          ? {
              ...x,
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
      await fetch(`/api/v1/tasks/${taskId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
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
        padding: "28px 36px 40px",
        display: "flex",
        flexDirection: "column",
        gap: 18,
      }}
      className="k-paper-noise"
    >
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div
            style={{
              fontFamily: "var(--f-mono)",
              fontSize: 11,
              letterSpacing: ".14em",
              textTransform: "uppercase",
              color: "var(--ink-muted)",
              marginBottom: 4,
            }}
          >
            Projekt-Board
          </div>
          <h1
            className="k-display"
            style={{
              margin: 0,
              fontSize: 34,
              fontVariationSettings: '"opsz" 96, "SOFT" 100',
            }}
          >
            Aufgaben
          </h1>
          <p
            style={{
              margin: "6px 0 0",
              color: "var(--ink-soft)",
              fontSize: 14,
            }}
          >
            {tasks.length} Aufgaben · {byColumn.laeuft.length} läuft · {byColumn.heute.length} heute
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <div
            style={{
              display: "inline-flex",
              background: "#fff",
              borderRadius: 10,
              border: "1px solid var(--line)",
              padding: 3,
            }}
          >
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
          await load();
        }}
        onDelete={
          dialogMode === "edit" && editingTask
            ? async () => {
                await fetch(`/api/v1/tasks/${editingTask.id}`, {
                  method: "DELETE",
                });
                await load();
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
  onTaskClick,
}: {
  col: { key: ColumnKey; label: string; hint: string; live?: boolean };
  tasks: ApiTask[];
  loading: boolean;
  onTaskClick: (t: ApiTask) => void;
}) {
  const { isOver, setNodeRef } = useDroppable({ id: col.key });
  return (
    <div
      style={{
        minWidth: 270,
        width: 270,
        flex: "0 0 auto",
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
          <DraggableTaskCard key={t.id} task={t} onClick={() => onTaskClick(t)} />
        ))}
      </div>
    </div>
  );
}

function DraggableTaskCard({
  task,
  onClick,
}: {
  task: ApiTask;
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
  onCardClick,
}: {
  task: ApiTask;
  dragging?: boolean;
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

  return (
    <div
      className="k-card"
      onClick={onCardClick}
      style={{
        padding: 12,
        cursor: dragging ? "grabbing" : onCardClick ? "pointer" : "grab",
        border: live
          ? "1px solid color-mix(in oklch, var(--kottke-accent) 30%, transparent)"
          : "1px solid var(--line)",
        background: done ? "color-mix(in srgb, var(--paper) 60%, #fff)" : "#fff",
        boxShadow: dragging ? "0 12px 32px -8px rgba(34,29,22,.25)" : undefined,
      }}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span
          style={{
            fontFamily: "var(--f-mono)",
            fontSize: 10,
            color: "var(--ink-muted)",
          }}
        >
          T-{task.id.slice(0, 6)}
        </span>
      </div>
      <div
        style={{
          fontWeight: 500,
          fontSize: 13.5,
          marginTop: 6,
          lineHeight: 1.35,
          textDecoration: done ? "line-through" : "none",
          color: done ? "var(--ink-muted)" : "var(--ink)",
        }}
      >
        {task.content}
      </div>

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
            gap: 4,
          }}
        >
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
