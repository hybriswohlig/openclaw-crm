"use client";

/**
 * Shadow-mode draft banner (Phase 1, docs/ai-sales-agent-plan.md).
 *
 * Shows the newest PENDING row from agent_drafts for the open conversation —
 * what the KI-Verkaufsassistent WOULD have sent. Nothing sends automatically:
 * "Übernehmen" copies the text into the composer (the operator remains the
 * sender), "Verwerfen" hides it. Both verdicts are stored on the draft
 * (edited/dismissed) and seed the Phase-2/4 learning loop.
 *
 * Companion to DraftSuggestionBanner (which reads the legacy note-based
 * drafts); this one reads the agent_drafts approval-queue table.
 */

import { useEffect, useState } from "react";
import { Bot, ChevronDown, ChevronUp, TriangleAlert, X } from "lucide-react";
import { cn } from "@/lib/utils";

export interface ShadowDraft {
  id: string;
  messageClass: string;
  text: string;
  priceFlag: boolean;
  createdAt: string;
}

interface ShadowDraftBannerProps {
  conversationId: string;
  /** Bump to refetch (host raises it after a send). */
  refreshKey?: number;
  onAcceptDraft: (text: string, draft: ShadowDraft) => void;
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
}: ShadowDraftBannerProps) {
  const [draft, setDraft] = useState<ShadowDraft | null>(null);
  const [hidden, setHidden] = useState(false);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setDraft(null);
    setHidden(false);
    setExpanded(false);
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
            KI-Verkaufsassistent · {CLASS_LABEL[draft.messageClass] ?? draft.messageClass} (Testmodus
            — sendet nie selbst)
          </div>
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
      <div className="flex items-center justify-end gap-2 pt-1">
        <button
          type="button"
          onClick={handleDiscard}
          className="text-xs font-medium text-muted-foreground hover:text-foreground"
        >
          Verwerfen
        </button>
        <button
          type="button"
          onClick={handleAccept}
          className="rounded-md bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-medium px-3 py-1.5"
        >
          Übernehmen
        </button>
      </div>
    </div>
  );
}
