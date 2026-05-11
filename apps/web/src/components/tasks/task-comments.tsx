"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Send, MessageSquare, Trash2 } from "lucide-react";
import { EmployeeAvatar } from "@/components/employees/employee-avatar";

interface CommentRow {
  id: string;
  body: string;
  createdAt: string;
  user: { id: string; name: string; email: string } | null;
}

interface TaskCommentsProps {
  taskId: string;
  currentUserId?: string;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) {
    return d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
  }
  return d.toLocaleString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function TaskComments({ taskId, currentUserId }: TaskCommentsProps) {
  const [comments, setComments] = useState<CommentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listEndRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/v1/tasks/${taskId}/comments`);
      if (!res.ok) {
        setError("Kommentare konnten nicht geladen werden.");
        return;
      }
      const data = await res.json();
      setComments((data?.data ?? []) as CommentRow[]);
      setError(null);
    } catch {
      setError("Netzwerkfehler beim Laden.");
    } finally {
      setLoading(false);
    }
  }, [taskId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    listEndRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [comments.length]);

  async function send() {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/tasks/${taskId}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: text }),
      });
      if (!res.ok) {
        setError("Senden fehlgeschlagen.");
        return;
      }
      const data = await res.json();
      const created = (data?.data ?? data) as CommentRow;
      setComments((prev) => [...prev, created]);
      setDraft("");
    } catch {
      setError("Netzwerkfehler beim Senden.");
    } finally {
      setSending(false);
    }
  }

  async function remove(commentId: string) {
    if (!window.confirm("Kommentar löschen?")) return;
    const before = comments;
    setComments((prev) => prev.filter((c) => c.id !== commentId));
    try {
      const res = await fetch(`/api/v1/tasks/${taskId}/comments/${commentId}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        setComments(before);
        setError("Löschen fehlgeschlagen.");
      }
    } catch {
      setComments(before);
      setError("Netzwerkfehler beim Löschen.");
    }
  }

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-center gap-2 text-[12px] font-medium text-muted-foreground">
        <MessageSquare className="h-3.5 w-3.5" />
        <span>Kommentare {comments.length > 0 ? `(${comments.length})` : ""}</span>
      </div>

      <div className="max-h-[220px] overflow-y-auto rounded-lg border border-border bg-muted/20 p-2">
        {loading ? (
          <div className="flex items-center justify-center py-4 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
          </div>
        ) : comments.length === 0 ? (
          <p className="py-3 text-center text-[12px] text-muted-foreground">
            Noch keine Kommentare.
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {comments.map((c) => {
              const name = c.user?.name ?? "Unbekannt";
              const isMine = c.user?.id && c.user.id === currentUserId;
              return (
                <div
                  key={c.id}
                  className="flex items-start gap-2 rounded-md bg-background px-2.5 py-2"
                >
                  <EmployeeAvatar name={name} size="xs" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                      <span className="text-[12px] font-medium">{name}</span>
                      <span className="text-[10px] text-muted-foreground tabular-nums">
                        {formatTime(c.createdAt)}
                      </span>
                    </div>
                    <p className="whitespace-pre-wrap break-words text-[13px] leading-snug text-foreground/90">
                      {c.body}
                    </p>
                  </div>
                  {isMine && (
                    <button
                      type="button"
                      onClick={() => remove(c.id)}
                      className="shrink-0 rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-destructive group-hover:opacity-100"
                      title="Löschen"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  )}
                </div>
              );
            })}
            <div ref={listEndRef} />
          </div>
        )}
      </div>

      <div className="flex items-end gap-2 rounded-2xl border border-input bg-muted/30 focus-within:bg-background px-3 py-2">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Kommentar schreiben…"
          rows={1}
          className="flex-1 resize-none bg-transparent text-[13px] outline-none placeholder:text-muted-foreground min-h-[24px] max-h-32"
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
        />
        <button
          type="button"
          onClick={send}
          disabled={!draft.trim() || sending}
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground disabled:opacity-40"
          title="Senden (Enter)"
        >
          {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        </button>
      </div>

      {error && (
        <p className="text-[11px] text-destructive">{error}</p>
      )}
    </div>
  );
}
