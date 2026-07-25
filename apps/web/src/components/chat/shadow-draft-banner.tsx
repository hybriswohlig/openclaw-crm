"use client";

/**
 * Approval-queue draft banner (Phase 1+2, docs/ai-sales-agent-plan.md).
 *
 * Shows the newest PENDING row from agent_drafts for the open conversation —
 * what the KI-Verkaufsassistent would send. Nothing sends automatically:
 * "Senden" (Phase 2) approves the draft and lets the server send it as-is,
 * "Übernehmen" copies the text into the composer (the operator remains the
 * sender), "Verwerfen" hides it. All verdicts are stored on the draft
 * (sent/edited/dismissed) and seed the Phase-2/4 learning loop.
 *
 * Companion to DraftSuggestionBanner (which reads the legacy note-based
 * drafts); this one reads the agent_drafts approval-queue table.
 */

import { useEffect, useState } from "react";
import {
  Bot,
  ChevronDown,
  ChevronUp,
  Loader2,
  Send,
  TriangleAlert,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";

export interface ShadowDraft {
  id: string;
  messageClass: string;
  text: string;
  priceFlag: boolean;
  /** Delivery unclear (send dispatched, outcome unknown) — warning-only state. */
  uncertain?: boolean;
  createdAt: string;
}

interface ShadowDraftBannerProps {
  conversationId: string;
  /** Bump to refetch (host raises it after a send). */
  refreshKey?: number;
  onAcceptDraft: (text: string, draft: ShadowDraft) => void;
  /** Phase 2: draft was approved and sent by the server — host reloads messages. */
  onSent?: () => void;
}

const CLASS_LABEL: Record<string, string> = {
  reply: "Antwort",
  slot_question: "Rückfrage",
  ack: "Bestätigung",
  followup: "Follow-up",
  first_contact: "Erstkontakt",
};

const PREVIEW_CHARS = 280;

export function ShadowDraftBanner({
  conversationId,
  refreshKey = 0,
  onAcceptDraft,
  onSent,
}: ShadowDraftBannerProps) {
  const [draft, setDraft] = useState<ShadowDraft | null>(null);
  const [hidden, setHidden] = useState(false);
  const [expanded, setExpanded] = useState(false);
  // Phase 2: approve_and_send in flight / inline error from the last attempt.
  const [approving, setApproving] = useState(false);
  const [approveError, setApproveError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setDraft(null);
    setHidden(false);
    setExpanded(false);
    setApproving(false);
    setApproveError(null);
    async function load() {
      try {
        const res = await fetch(
          `/api/v1/agent-drafts?conversationId=${encodeURIComponent(conversationId)}`,
          { cache: "no-store" }
        );
        if (!res.ok) return;
        const json = await res.json();
        const d = (json?.data?.draft ?? json?.draft ?? null) as ShadowDraft | null;
        if (!cancelled && d?.text) setDraft(d);
      } catch {
        // Banner is best-effort; the conversation UI must never break on it.
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [conversationId, refreshKey]);

  if (!draft || hidden) return null;

  const truncated = draft.text.length > PREVIEW_CHARS;
  const previewBody = expanded ? draft.text : draft.text.slice(0, PREVIEW_CHARS);

  async function verdict(action: "taken" | "dismissed") {
    try {
      await fetch(`/api/v1/agent-drafts/${draft!.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
    } catch {
      // Best-effort: the local UI action already happened.
    }
  }

  function handleAccept() {
    onAcceptDraft(draft!.text, draft!);
    setHidden(true);
    void verdict("taken");
  }

  function handleDiscard() {
    setHidden(true);
    void verdict("dismissed");
  }

  // Phase 2: approve the draft — the server sends it verbatim over the channel.
  // On a 409 the draft stays visible with an inline German error so the
  // operator can fall back to Übernehmen/Verwerfen.
  async function handleApproveSend() {
    if (approving) return;
    setApproving(true);
    setApproveError(null);
    try {
      const res = await fetch(`/api/v1/agent-drafts/${draft!.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "approve_and_send" }),
      });
      if (res.ok) {
        setHidden(true);
        onSent?.();
        return;
      }
      const json = (await res.json().catch(() => ({}))) as {
        error?: string;
        reasons?: string[];
        detail?: string;
      };
      switch (json?.error) {
        case "gate_blocked":
          setApproveError(`Gate blockiert: ${(json.reasons ?? []).join(", ")}`);
          break;
        case "price_leak":
          setApproveError("Preis-Scanner blockiert — bitte manuell prüfen");
          break;
        case "session_expired":
          setApproveError(json.detail ?? "Das Antwortfenster ist abgelaufen.");
          break;
        case "send_uncertain":
          // Delivery unclear — flip the banner into the warning-only state.
          setDraft((d) => (d ? { ...d, uncertain: true } : d));
          setApproveError(
            json.detail ?? "Zustellung unklar — bitte den Verlauf prüfen, nichts erneut senden."
          );
          break;
        case "expired":
          setApproveError("Entwurf abgelaufen");
          window.setTimeout(() => setHidden(true), 1800);
          break;
        case "not_pending":
          // Draft was already handled elsewhere — show why, then hide.
          setApproveError("Bereits bearbeitet");
          window.setTimeout(() => setHidden(true), 1800);
          break;
        default:
          setApproveError("Senden fehlgeschlagen — bitte erneut versuchen.");
      }
    } catch {
      setApproveError("Senden fehlgeschlagen — bitte erneut versuchen.");
    } finally {
      setApproving(false);
    }
  }

  return (
    <div
      className={cn(
        "rounded-lg border border-emerald-500/30 bg-emerald-500/5",
        "px-3 py-2 text-sm space-y-1.5"
      )}
      data-testid="shadow-draft-banner"
    >
      <div className="flex items-start gap-2">
        <Bot className="h-3.5 w-3.5 mt-0.5 shrink-0 text-emerald-600" />
        <div className="flex-1 min-w-0">
          <div className="text-xs font-medium text-emerald-700">
            KI-Verkaufsassistent · {CLASS_LABEL[draft.messageClass] ?? draft.messageClass} (sendet
            nur nach deiner Freigabe)
          </div>
          {draft.uncertain && (
            <div className="inline-flex items-center gap-1 text-xs font-medium text-amber-700 mt-1">
              <TriangleAlert className="h-3 w-3" />
              Zustellung unklar — prüfe im Verlauf, ob die Nachricht ankam, bevor du irgendetwas
              erneut sendest. Verwerfen bestätigt, dass du es geprüft hast.
            </div>
          )}
          {draft.priceFlag && (
            <div className="inline-flex items-center gap-1 text-xs font-medium text-amber-700 mt-1">
              <TriangleAlert className="h-3 w-3" />
              Preis-Scanner hat angeschlagen — vor dem Senden prüfen!
            </div>
          )}
          <pre className="whitespace-pre-wrap font-sans text-xs text-foreground/90 mt-1 leading-snug">
            {previewBody}
            {!expanded && truncated ? "…" : ""}
          </pre>
          {truncated && (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 hover:underline mt-1"
            >
              {expanded ? (
                <>
                  <ChevronUp className="h-3 w-3" />
                  weniger anzeigen
                </>
              ) : (
                <>
                  <ChevronDown className="h-3 w-3" />
                  alles ansehen
                </>
              )}
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={handleDiscard}
          className="shrink-0 p-1 rounded hover:bg-emerald-500/10 text-muted-foreground hover:text-foreground transition-colors"
          title="Verwerfen"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      {approveError && (
        <div className="flex items-start gap-1.5 text-xs font-medium text-red-700">
          <TriangleAlert className="h-3 w-3 mt-0.5 shrink-0" />
          <span>{approveError}</span>
        </div>
      )}
      <div className="flex items-center justify-end gap-2 pt-1">
        <button
          type="button"
          onClick={handleDiscard}
          disabled={approving}
          className="text-xs font-medium text-muted-foreground hover:text-foreground disabled:opacity-50"
        >
          Verwerfen
        </button>
        {!draft.uncertain && (
          <>
            <button
              type="button"
              onClick={handleApproveSend}
              disabled={approving}
              className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-medium px-3 py-1.5 disabled:opacity-60"
            >
              {approving ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Send className="h-3.5 w-3.5" />
              )}
              Senden
            </button>
            <button
              type="button"
              onClick={handleAccept}
              disabled={approving}
              className="rounded-md border border-emerald-600/40 text-emerald-700 hover:bg-emerald-500/10 text-xs font-medium px-3 py-1.5 disabled:opacity-50"
            >
              Übernehmen
            </button>
          </>
        )}
      </div>
    </div>
  );
}
