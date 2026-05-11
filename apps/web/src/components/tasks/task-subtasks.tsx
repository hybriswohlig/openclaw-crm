"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Loader2, Plus, ListTree } from "lucide-react";

interface SubtaskRow {
  id: string;
  content: string;
  isCompleted: boolean;
  completedAt: string | null;
  deadline: string | null;
  createdAt: string;
}

export function TaskSubtasks({ taskId }: { taskId: string }) {
  const [rows, setRows] = useState<SubtaskRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [newContent, setNewContent] = useState("");
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/v1/tasks/${taskId}/subtasks`);
      if (!res.ok) {
        setError("Subtasks konnten nicht geladen werden.");
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

  async function toggle(sub: SubtaskRow) {
    const next = !sub.isCompleted;
    // Optimistic flip
    setRows((prev) =>
      prev.map((r) =>
        r.id === sub.id
          ? { ...r, isCompleted: next, completedAt: next ? new Date().toISOString() : null }
          : r
      )
    );
    try {
      const res = await fetch(`/api/v1/tasks/${sub.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isCompleted: next }),
      });
      if (!res.ok) {
        // Roll back
        setRows((prev) =>
          prev.map((r) =>
            r.id === sub.id
              ? { ...r, isCompleted: sub.isCompleted, completedAt: sub.completedAt }
              : r
          )
        );
      }
    } catch {
      setRows((prev) =>
        prev.map((r) =>
          r.id === sub.id
            ? { ...r, isCompleted: sub.isCompleted, completedAt: sub.completedAt }
            : r
        )
      );
    }
  }

  const completed = rows.filter((r) => r.isCompleted).length;

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-center gap-2 text-[12px] font-medium text-muted-foreground">
        <ListTree className="h-3.5 w-3.5" />
        <span>
          Subtasks {rows.length > 0 ? `(${completed}/${rows.length})` : ""}
        </span>
      </div>

      {rows.length > 0 && (
        <div className="rounded-lg border border-border bg-muted/20 p-1.5">
          {rows.map((r) => (
            <div
              key={r.id}
              className="flex items-start gap-2 rounded-md px-2 py-1.5 hover:bg-background/60"
            >
              <button
                type="button"
                onClick={() => toggle(r)}
                className={`mt-[3px] inline-flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                  r.isCompleted
                    ? "bg-primary border-primary text-primary-foreground"
                    : "border-input bg-background"
                }`}
                aria-label={r.isCompleted ? "Wieder öffnen" : "Erledigen"}
              >
                {r.isCompleted ? <Check className="h-3 w-3" /> : null}
              </button>
              <span
                className={`whitespace-pre-wrap break-words text-[13px] leading-snug ${
                  r.isCompleted ? "text-muted-foreground line-through" : "text-foreground"
                }`}
              >
                {r.content}
              </span>
            </div>
          ))}
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
          placeholder="Subtask hinzufügen…"
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
