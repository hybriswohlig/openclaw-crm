"use client";

// Subtasks rendered as full mini-tasks: each row can be expanded to set its
// own owner(s), due date, size and to hold its own comment thread — reusing
// the same task endpoints (subtasks ARE tasks with a parent_task_id). Kept
// inline inside the parent dialog so there are no nested popups.
import { useCallback, useEffect, useState } from "react";
import {
  Check,
  Loader2,
  Plus,
  ListTree,
  ChevronRight,
  ChevronDown,
  Trash2,
  User,
  Calendar,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { TaskComments } from "./task-comments";

interface Member {
  id: string;
  userId: string;
  name: string;
  email: string;
}

interface SubtaskRow {
  id: string;
  content: string;
  isCompleted: boolean;
  completedAt: string | null;
  deadline: string | null;
  createdAt: string;
  assignees: { id: string; name: string; email: string }[];
  pointEstimate: number | null;
}

const SIZE_OPTIONS = [1, 2, 3, 5, 8, 13] as const;

function initials(name: string): string {
  const parts = (name || "?").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function TaskSubtasks({
  taskId,
  members,
  currentUserId,
}: {
  taskId: string;
  members: Member[];
  currentUserId?: string;
}) {
  const [rows, setRows] = useState<SubtaskRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [newContent, setNewContent] = useState("");
  const [adding, setAdding] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/v1/tasks/${taskId}/subtasks`);
      if (!res.ok) {
        setError("Unteraufgaben konnten nicht geladen werden.");
        return;
      }
      const data = await res.json();
      setRows((data?.data ?? []) as SubtaskRow[]);
      setError(null);
    } catch {
      setError("Netzwerkfehler.");
    } finally {
      setLoading(false);
    }
  }, [taskId]);

  useEffect(() => {
    load();
  }, [load]);

  async function add() {
    const text = newContent.trim();
    if (!text || adding) return;
    setAdding(true);
    try {
      const res = await fetch(`/api/v1/tasks/${taskId}/subtasks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: text }),
      });
      if (!res.ok) {
        setError("Anlegen fehlgeschlagen.");
        return;
      }
      const data = await res.json();
      const created = (data?.data ?? data) as SubtaskRow;
      setRows((prev) => [...prev, created]);
      setNewContent("");
    } catch {
      setError("Netzwerkfehler.");
    } finally {
      setAdding(false);
    }
  }

  // Generic PATCH against the subtask (it is a real task row) + local merge.
  const patchSub = useCallback(
    async (id: string, body: Record<string, unknown>, optimistic?: Partial<SubtaskRow>) => {
      if (optimistic) {
        setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...optimistic } : r)));
      }
      try {
        const res = await fetch(`/api/v1/tasks/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          toast.error("Änderung konnte nicht gespeichert werden");
          load();
          return;
        }
        const data = await res.json();
        const updated = (data?.data ?? data) as SubtaskRow;
        setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...updated } : r)));
      } catch {
        toast.error("Änderung konnte nicht gespeichert werden");
        load();
      }
    },
    [load]
  );

  function toggleComplete(sub: SubtaskRow) {
    const next = !sub.isCompleted;
    patchSub(
      sub.id,
      { isCompleted: next },
      { isCompleted: next, completedAt: next ? new Date().toISOString() : null }
    );
  }

  function toggleAssignee(sub: SubtaskRow, userId: string) {
    const has = sub.assignees.some((a) => a.id === userId);
    const nextIds = has
      ? sub.assignees.filter((a) => a.id !== userId).map((a) => a.id)
      : [...sub.assignees.map((a) => a.id), userId];
    patchSub(sub.id, { assigneeIds: nextIds });
  }

  async function del(sub: SubtaskRow) {
    if (!confirm("Unteraufgabe löschen?")) return;
    setRows((prev) => prev.filter((r) => r.id !== sub.id));
    try {
      const res = await fetch(`/api/v1/tasks/${sub.id}`, { method: "DELETE" });
      if (!res.ok) {
        toast.error("Unteraufgabe konnte nicht gelöscht werden");
        load();
      }
    } catch {
      toast.error("Unteraufgabe konnte nicht gelöscht werden");
      load();
    }
  }

  const completed = rows.filter((r) => r.isCompleted).length;

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-center gap-2 text-[12px] font-medium text-muted-foreground">
        <ListTree className="h-3.5 w-3.5" />
        <span>Unteraufgaben {rows.length > 0 ? `(${completed}/${rows.length})` : ""}</span>
      </div>

      {rows.length > 0 && (
        <div className="rounded-lg border border-border bg-muted/20 p-1.5">
          {rows.map((r) => {
            const open = expandedId === r.id;
            return (
              <div key={r.id} className="rounded-md">
                {/* Row */}
                <div className="flex items-start gap-2 px-2 py-1.5 hover:bg-background/60 rounded-md">
                  <button
                    type="button"
                    onClick={() => toggleComplete(r)}
                    className={cn(
                      "mt-[3px] inline-flex h-4 w-4 shrink-0 items-center justify-center rounded border",
                      r.isCompleted
                        ? "bg-primary border-primary text-primary-foreground"
                        : "border-input bg-background"
                    )}
                    aria-label={r.isCompleted ? "Wieder öffnen" : "Erledigen"}
                  >
                    {r.isCompleted ? <Check className="h-3 w-3" /> : null}
                  </button>

                  <button
                    type="button"
                    onClick={() => setExpandedId(open ? null : r.id)}
                    className="flex flex-1 items-start gap-2 text-left"
                  >
                    {open ? (
                      <ChevronDown className="mt-[2px] h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    ) : (
                      <ChevronRight className="mt-[2px] h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    )}
                    <span
                      className={cn(
                        "whitespace-pre-wrap break-words text-[13px] leading-snug",
                        r.isCompleted ? "text-muted-foreground line-through" : "text-foreground"
                      )}
                    >
                      {r.content}
                    </span>
                  </button>

                  {/* Compact meta on the right */}
                  <div className="flex shrink-0 items-center gap-1.5">
                    {r.pointEstimate != null && (
                      <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-emerald-700">
                        {r.pointEstimate}p
                      </span>
                    )}
                    {r.assignees.slice(0, 2).map((a) => (
                      <span
                        key={a.id}
                        title={a.name || a.email}
                        className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-background bg-primary/20 text-[9px] font-semibold text-primary"
                      >
                        {initials(a.name || a.email)}
                      </span>
                    ))}
                  </div>
                </div>

                {/* Expanded detail */}
                {open && (
                  <div className="ml-6 mr-1 mb-1.5 space-y-3 rounded-md border border-border bg-background/70 p-2.5">
                    {/* Owner */}
                    <div>
                      <div className="mb-1 flex items-center gap-1 text-[11px] text-muted-foreground">
                        <User className="h-3 w-3" /> Verantwortlich
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {members.length === 0 && (
                          <span className="text-[11px] text-muted-foreground">Keine Mitglieder</span>
                        )}
                        {members.map((m) => {
                          const active = r.assignees.some((a) => a.id === m.userId);
                          return (
                            <button
                              key={m.userId}
                              type="button"
                              onClick={() => toggleAssignee(r, m.userId)}
                              className={cn(
                                "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px]",
                                active
                                  ? "border-primary bg-primary/10 text-foreground"
                                  : "border-border bg-background text-muted-foreground hover:bg-muted/50"
                              )}
                            >
                              <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-primary/20 text-[8px] font-semibold text-primary">
                                {initials(m.name || m.email)}
                              </span>
                              {(m.name || m.email).split(/\s+/)[0]}
                              {m.userId === currentUserId && " (Du)"}
                              {active && <Check className="h-3 w-3 text-primary" />}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Due + size */}
                    <div className="flex flex-wrap items-center gap-4">
                      <div className="flex items-center gap-1.5">
                        <Calendar className="h-3 w-3 text-muted-foreground" />
                        <input
                          type="date"
                          value={r.deadline ? r.deadline.slice(0, 10) : ""}
                          onChange={(e) =>
                            patchSub(r.id, { deadline: e.target.value || null }, {
                              deadline: e.target.value || null,
                            })
                          }
                          className="h-7 rounded-md border border-border bg-background px-2 text-[11px]"
                        />
                      </div>
                      <div className="flex items-center gap-1">
                        <span className="text-[11px] text-muted-foreground">Größe</span>
                        <div className="inline-flex overflow-hidden rounded-md border border-border">
                          {SIZE_OPTIONS.map((pts) => {
                            const active = r.pointEstimate === pts;
                            return (
                              <button
                                key={pts}
                                type="button"
                                onClick={() =>
                                  patchSub(r.id, {
                                    pointEstimate: active ? null : pts,
                                  }, { pointEstimate: active ? null : pts })
                                }
                                className={cn(
                                  "px-1.5 py-0.5 text-[11px] tabular-nums border-r border-border last:border-r-0",
                                  active
                                    ? "bg-emerald-600 text-white"
                                    : "bg-background text-muted-foreground hover:bg-muted/50"
                                )}
                              >
                                {pts}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => del(r)}
                        className="ml-auto inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-destructive"
                      >
                        <Trash2 className="h-3 w-3" /> Löschen
                      </button>
                    </div>

                    {/* Comments */}
                    <div className="border-t border-border pt-2">
                      <TaskComments taskId={r.id} currentUserId={currentUserId} />
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {loading && rows.length === 0 ? (
        <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" /> Lade…
        </div>
      ) : null}

      <div className="flex items-center gap-2 rounded-full border border-input bg-muted/30 px-2 py-1 focus-within:bg-background">
        <Plus className="h-3.5 w-3.5 text-muted-foreground" />
        <input
          value={newContent}
          onChange={(e) => setNewContent(e.target.value)}
          placeholder="Unteraufgabe hinzufügen…"
          className="flex-1 bg-transparent text-[13px] outline-none placeholder:text-muted-foreground"
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
        />
        <button
          type="button"
          onClick={add}
          disabled={!newContent.trim() || adding}
          className="rounded-full p-1 text-muted-foreground hover:bg-muted disabled:opacity-40"
        >
          {adding ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
        </button>
      </div>

      {error && <p className="text-[11px] text-destructive">{error}</p>}
    </div>
  );
}
