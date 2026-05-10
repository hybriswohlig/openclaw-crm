"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Check,
  Loader2,
  Pencil,
  RefreshCw,
  Send,
  Sparkles,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

interface PendingDraftDTO {
  noteId: string;
  recordId: string;
  recordDisplayName: string;
  objectSlug: string;
  objectName: string;
  conversationId: string | null;
  channelType: "email" | "whatsapp" | null;
  contactName: string | null;
  contactAddress: string | null;
  subject: string | null;
  leadSource: string | null;
  body: string;
  snippet: string;
  createdAt: string;
  updatedAt: string;
}

const POLL_INTERVAL_MS = 30_000;

function formatAge(iso: string, now: number): string {
  const created = new Date(iso).getTime();
  if (Number.isNaN(created)) return "";
  const diffMs = Math.max(0, now - created);
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return "gerade eben";
  if (mins < 60) return `vor ${mins} min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `vor ${hours} h`;
  const days = Math.floor(hours / 24);
  return `vor ${days} d`;
}

function leadSourceChipClasses(source: string | null): string {
  if (!source) return "bg-muted text-muted-foreground";
  // Roughly match the per-source colors used elsewhere.
  if (/whatsapp|website/i.test(source))
    return "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400";
  if (/kleinanzeigen/i.test(source))
    return "bg-orange-500/10 text-orange-700 dark:text-orange-400";
  if (/immobilienscout/i.test(source))
    return "bg-rose-500/10 text-rose-700 dark:text-rose-400";
  if (/check24/i.test(source))
    return "bg-sky-500/10 text-sky-700 dark:text-sky-400";
  if (/gbp/i.test(source))
    return "bg-violet-500/10 text-violet-700 dark:text-violet-400";
  return "bg-muted text-foreground";
}

export function DraftsInboxClient() {
  const [drafts, setDrafts] = useState<PendingDraftDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const [busyId, setBusyId] = useState<string | null>(null);
  const [editing, setEditing] = useState<PendingDraftDTO | null>(null);
  const [editBody, setEditBody] = useState("");
  const [toast, setToast] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((kind: "ok" | "err", text: string) => {
    setToast({ kind, text });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3500);
  }, []);

  const load = useCallback(async (mode: "initial" | "refresh") => {
    if (mode === "initial") setLoading(true);
    else setRefreshing(true);
    try {
      const res = await fetch("/api/v1/inbox/drafts", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      const rows: PendingDraftDTO[] = Array.isArray(json?.data?.drafts)
        ? json.data.drafts
        : [];
      setDrafts(rows);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Konnte Entwürfe nicht laden");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load("initial");
  }, [load]);

  // Auto-refresh + age tick.
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 30_000);
    const poll = setInterval(() => {
      void load("refresh");
    }, POLL_INTERVAL_MS);
    return () => {
      clearInterval(tick);
      clearInterval(poll);
    };
  }, [load]);

  // If the URL has a #draft-<id> anchor, scroll it into view once loaded.
  useEffect(() => {
    if (loading) return;
    if (typeof window === "undefined") return;
    const hash = window.location.hash;
    if (!hash.startsWith("#draft-")) return;
    const el = document.getElementById(hash.slice(1));
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.classList.add("ring-2", "ring-violet-500");
      setTimeout(() => el.classList.remove("ring-2", "ring-violet-500"), 2500);
    }
  }, [loading, drafts.length]);

  const handleApprove = useCallback(
    async (draft: PendingDraftDTO, bodyOverride?: string) => {
      if (busyId) return;
      if (!draft.conversationId) {
        showToast(
          "err",
          `${draft.recordDisplayName}: keine Konversation verknüpft — bitte im Datensatz manuell antworten.`
        );
        return;
      }
      setBusyId(draft.noteId);
      try {
        const res = await fetch(
          `/api/v1/inbox/drafts/${draft.noteId}/approve`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: bodyOverride
              ? JSON.stringify({ body: bodyOverride })
              : "{}",
          }
        );
        if (!res.ok) {
          const j = await res.json().catch(() => null);
          const msg =
            j?.error?.message ?? j?.error ?? `Senden fehlgeschlagen (${res.status})`;
          throw new Error(typeof msg === "string" ? msg : "Senden fehlgeschlagen");
        }
        // Drop the row optimistically.
        setDrafts((prev) => prev.filter((d) => d.noteId !== draft.noteId));
        setEditing(null);
        showToast("ok", `Antwort an ${draft.recordDisplayName} gesendet.`);
      } catch (err) {
        showToast(
          "err",
          err instanceof Error ? err.message : "Senden fehlgeschlagen"
        );
      } finally {
        setBusyId(null);
      }
    },
    [busyId, showToast]
  );

  const openEditor = useCallback((draft: PendingDraftDTO) => {
    setEditing(draft);
    setEditBody(draft.body);
  }, []);

  const closeEditor = useCallback(() => {
    setEditing(null);
    setEditBody("");
  }, []);

  const saveEdit = useCallback(async () => {
    if (!editing) return;
    if (busyId) return;
    setBusyId(editing.noteId);
    try {
      // The server stores TipTap JSON; for an edit-from-the-queue the simplest
      // representation is one paragraph per line. The agent-drafts extractor
      // round-trips this back to the same plain text on next read.
      const tiptap = {
        type: "doc",
        content: editBody.split(/\r?\n/).map((line) => ({
          type: "paragraph",
          content: line.length
            ? [{ type: "text", text: line }]
            : [],
        })),
      };
      const res = await fetch(`/api/v1/notes/${editing.noteId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: tiptap }),
      });
      if (!res.ok) throw new Error(`PATCH failed (${res.status})`);
      // Update local row body so a follow-up Approve uses the new text even
      // before the next refresh.
      setDrafts((prev) =>
        prev.map((d) =>
          d.noteId === editing.noteId
            ? { ...d, body: editBody, snippet: editBody.slice(0, 220) }
            : d
        )
      );
      showToast("ok", "Entwurf gespeichert.");
    } catch (err) {
      showToast("err", err instanceof Error ? err.message : "Speichern fehlgeschlagen");
    } finally {
      setBusyId(null);
    }
  }, [editing, editBody, busyId, showToast]);

  const approveFromEditor = useCallback(async () => {
    if (!editing) return;
    await handleApprove(editing, editBody);
  }, [editing, editBody, handleApprove]);

  const headerCount = useMemo(() => drafts.length, [drafts.length]);

  return (
    <div className="flex flex-col h-full min-h-0 bg-background">
      {/* Header */}
      <div className="border-b border-border px-3 py-2.5 sm:px-4 sm:py-3 flex items-center gap-2">
        <Link
          href="/inbox"
          className="p-1.5 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground"
          title="Zurück zur Inbox"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <Sparkles className="h-4 w-4 text-violet-600 shrink-0" />
        <div className="flex-1 min-w-0">
          <h1 className="text-sm font-semibold leading-tight">Antwort-Entwürfe</h1>
          <p className="text-[11px] text-muted-foreground leading-tight">
            {loading
              ? "Lade…"
              : headerCount === 0
                ? "Keine offenen Entwürfe"
                : headerCount === 1
                  ? "1 offener Entwurf"
                  : `${headerCount} offene Entwürfe`}
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => void load("refresh")}
          disabled={refreshing}
          title="Aktualisieren"
        >
          <RefreshCw
            className={cn("h-3.5 w-3.5", refreshing && "animate-spin")}
          />
        </Button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-3 sm:px-4 py-3">
        {error && (
          <div className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive mb-3">
            {error}
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-16 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : drafts.length === 0 ? (
          <EmptyState />
        ) : (
          <ul className="space-y-2.5 max-w-3xl mx-auto">
            {drafts.map((draft) => (
              <DraftCard
                key={draft.noteId}
                draft={draft}
                now={now}
                busy={busyId === draft.noteId}
                onApprove={() => handleApprove(draft)}
                onEdit={() => openEditor(draft)}
              />
            ))}
          </ul>
        )}
      </div>

      {/* Toast */}
      {toast && (
        <div
          className={cn(
            "fixed bottom-4 left-1/2 -translate-x-1/2 z-50 rounded-lg px-3 py-2 text-xs font-medium shadow-lg max-w-[92vw]",
            toast.kind === "ok"
              ? "bg-emerald-600 text-white"
              : "bg-destructive text-destructive-foreground"
          )}
        >
          {toast.text}
        </div>
      )}

      {/* Editor modal */}
      {editing && (
        <EditorModal
          draft={editing}
          body={editBody}
          onChange={setEditBody}
          onClose={closeEditor}
          onSave={saveEdit}
          onSend={approveFromEditor}
          busy={busyId === editing.noteId}
        />
      )}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center text-muted-foreground">
      <Sparkles className="h-8 w-8 text-violet-500/50 mb-3" />
      <div className="text-sm font-medium text-foreground">Alles erledigt.</div>
      <div className="text-xs mt-1 max-w-[260px]">
        Sobald der Sales-Outreach-Agent einen neuen Antwort-Entwurf hinterlegt,
        landet er hier.
      </div>
    </div>
  );
}

function DraftCard({
  draft,
  now,
  busy,
  onApprove,
  onEdit,
}: {
  draft: PendingDraftDTO;
  now: number;
  busy: boolean;
  onApprove: () => void;
  onEdit: () => void;
}) {
  const recordHref = `/objects/${draft.objectSlug}/records/${draft.recordId}`;
  const noConv = !draft.conversationId;
  return (
    <li
      id={`draft-${draft.noteId}`}
      className={cn(
        "rounded-lg border border-border bg-card text-card-foreground",
        "transition-colors",
        busy && "opacity-60"
      )}
    >
      <div className="px-3 py-2.5 sm:px-4 sm:py-3 flex flex-col gap-2">
        {/* Top row: record + lead source + age */}
        <div className="flex items-start gap-2 min-w-0">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Link
                href={recordHref}
                className="font-medium text-foreground hover:underline truncate"
              >
                {draft.recordDisplayName}
              </Link>
              {draft.objectName && (
                <span className="hidden sm:inline">· {draft.objectName}</span>
              )}
            </div>
            {(draft.contactName || draft.contactAddress) && (
              <div className="text-[11px] text-muted-foreground truncate mt-0.5">
                {draft.contactName ?? draft.contactAddress}
                {draft.contactName && draft.contactAddress
                  ? ` · ${draft.contactAddress}`
                  : ""}
                {draft.subject ? ` · „${draft.subject}"` : ""}
              </div>
            )}
          </div>
          <div className="flex flex-col items-end gap-1 shrink-0">
            <span
              className={cn(
                "text-[10px] font-semibold uppercase tracking-wide rounded-full px-2 py-0.5",
                leadSourceChipClasses(draft.leadSource)
              )}
              title={draft.leadSource ?? "Lead-Quelle unbekannt"}
            >
              {draft.leadSource ?? "—"}
            </span>
            <span className="text-[10px] text-muted-foreground">
              {formatAge(draft.createdAt, now)}
            </span>
          </div>
        </div>

        {/* Snippet */}
        <p className="text-xs text-foreground/80 leading-snug whitespace-pre-line line-clamp-3">
          {draft.snippet || draft.body}
        </p>

        {noConv && (
          <div className="rounded-md border border-amber-500/40 bg-amber-500/5 px-2 py-1 text-[11px] text-amber-700 dark:text-amber-400">
            Keine Konversation verknüpft — Senden funktioniert hier nicht. Bitte
            im Datensatz antworten.
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center gap-2 pt-1">
          <Button
            size="sm"
            variant="outline"
            onClick={onEdit}
            disabled={busy}
          >
            <Pencil className="h-3.5 w-3.5" />
            Bearbeiten
          </Button>
          <Button
            size="sm"
            onClick={onApprove}
            disabled={busy || noConv}
            className={cn(
              "bg-violet-600 hover:bg-violet-700 text-white",
              "disabled:bg-violet-600/40"
            )}
          >
            {busy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Check className="h-3.5 w-3.5" />
            )}
            Senden
          </Button>
        </div>
      </div>
    </li>
  );
}

function EditorModal({
  draft,
  body,
  onChange,
  onClose,
  onSave,
  onSend,
  busy,
}: {
  draft: PendingDraftDTO;
  body: string;
  onChange: (v: string) => void;
  onClose: () => void;
  onSave: () => void;
  onSend: () => void;
  busy: boolean;
}) {
  return (
    <div
      className="fixed inset-0 z-40 bg-black/50 flex items-end sm:items-center justify-center p-2 sm:p-4"
      onClick={onClose}
    >
      <div
        className="bg-background rounded-t-xl sm:rounded-xl border border-border shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-3 sm:px-4 py-2.5 border-b border-border">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold truncate">
              Entwurf bearbeiten · {draft.recordDisplayName}
            </h2>
            <p className="text-[11px] text-muted-foreground truncate">
              {draft.contactAddress ?? draft.contactName ?? draft.objectName}
              {draft.subject ? ` · „${draft.subject}"` : ""}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto p-3 sm:p-4">
          <textarea
            value={body}
            onChange={(e) => onChange(e.target.value)}
            disabled={busy}
            rows={14}
            className={cn(
              "w-full resize-y rounded-md border border-border bg-background",
              "px-3 py-2 text-sm font-sans leading-snug",
              "focus:outline-none focus:ring-2 focus:ring-violet-500"
            )}
          />
        </div>
        <div className="flex items-center justify-end gap-2 px-3 sm:px-4 py-2.5 border-t border-border">
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            disabled={busy}
          >
            Abbrechen
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={onSave}
            disabled={busy || !body.trim()}
          >
            <Pencil className="h-3.5 w-3.5" />
            Speichern
          </Button>
          <Button
            size="sm"
            onClick={onSend}
            disabled={busy || !body.trim() || !draft.conversationId}
            className="bg-violet-600 hover:bg-violet-700 text-white"
          >
            {busy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Send className="h-3.5 w-3.5" />
            )}
            Speichern & senden
          </Button>
        </div>
      </div>
    </div>
  );
}
